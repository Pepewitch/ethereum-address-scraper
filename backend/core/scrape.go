package core

import (
	"backend/cache"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/weppos/publicsuffix-go/publicsuffix"
	"golang.org/x/net/html"
)

const maxCacheSize = 1000

var (
	targetCache = cache.NewFixedSizeCache(maxCacheSize)
	scriptCache = cache.NewFixedSizeCache(maxCacheSize)
)

type AddressInfo struct {
	Address string   `json:"address"`
	Src     string   `json:"src"`
	Type    string   `json:"type"`
	Targets []string `json:"targets"`
}

const (
	userAgent      = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
	maxContentSize = 20 * 1024 * 1024 // 20MB in bytes
)

// Function to extract script URLs from HTML content
func extractScripts(htmlContent string) []string {
	var scripts []string
	doc, err := html.Parse(strings.NewReader(htmlContent))
	if err != nil {
		log.Printf("Error parsing HTML: %v", err)
		return scripts
	}
	var f func(*html.Node)
	f = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "script" {
			for _, attr := range n.Attr {
				if attr.Key == "src" {
					scripts = append(scripts, attr.Val)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			f(c)
		}
	}
	f(doc)
	return scripts
}

// Function to resolve full script URL
func resolveURL(base, ref string) (string, error) {
	baseURL, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	refURL, err := url.Parse(ref)
	if err != nil {
		return "", err
	}

	if !refURL.IsAbs() && refURL.Path != "" && !strings.HasPrefix(refURL.Path, "/") {
		refURL.Path = "/" + refURL.Path
	}

	return baseURL.ResolveReference(refURL).String(), nil
}

// Function to fetch script content
func fetchScriptContent(scriptURL string) (string, error) {
	client := &http.Client{
		Timeout: 3 * time.Second,
	}
	req, err := http.NewRequest("GET", scriptURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	limitedReader := io.LimitReader(resp.Body, maxContentSize)
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", err
	}

	if len(body) >= maxContentSize {
		return "", errors.New("content exceeds maximum size of 20MB")
	}

	return string(body), nil
}

// Function to fetch HTML content
func fetchHTMLContent(targetURL string) (string, error) {
	client := &http.Client{
		Timeout: 3 * time.Second,
	}
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	limitedReader := io.LimitReader(resp.Body, maxContentSize)
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", err
	}

	if len(body) >= maxContentSize {
		return "", errors.New("content exceeds maximum size of 20MB")
	}

	return string(body), nil
}

// Function to find addresses matching the regex pattern
func findAddressInfos(content, src, contentType, target string) []AddressInfo {
	re := regexp.MustCompile(`0x[0-9a-fA-F]{40}`)
	matches := re.FindAllString(content, -1)
	var addressInfos []AddressInfo
	for _, match := range matches {
		addressInfos = append(addressInfos, AddressInfo{
			Address: match,
			Src:     src,
			Type:    contentType,
			Targets: []string{target},
		})
	}
	return addressInfos
}

// Function to ensure addressInfos are unique by address, src, and type, and targets are unique
func uniqueAddressInfos(addressInfos []AddressInfo) []AddressInfo {
	seen := make(map[string]AddressInfo)
	for _, info := range addressInfos {
		key := info.Address + info.Src + info.Type
		if existing, ok := seen[key]; ok {
			targetMap := make(map[string]bool)
			for _, t := range existing.Targets {
				targetMap[t] = true
			}
			for _, t := range info.Targets {
				if !targetMap[t] {
					existing.Targets = append(existing.Targets, t)
					targetMap[t] = true
				}
			}
			seen[key] = existing
		} else {
			seen[key] = info
		}
	}
	var unique []AddressInfo
	for _, info := range seen {
		unique = append(unique, info)
	}
	return unique
}

// Function to get the top-level domain
func getTopLevelDomain(hostname string) (string, error) {
	domain, err := publicsuffix.Domain(hostname)
	if err != nil {
		return "", err
	}
	return domain, nil
}

var blacklistHostnames = []string{
	"google.com",
	"localhost:5173",
	"ethereum-address-scraper-api-n3j67ioglq-as.a.run.app",
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func Scrape(targets []string) ([]AddressInfo, error) {
	var allAddressInfos []AddressInfo

	for _, target := range targets {
		addressInfos, err := scrapeTarget(target)
		if err != nil {
			log.Printf("Error scraping target %s: %v", target, err)
			continue
		}
		allAddressInfos = append(allAddressInfos, addressInfos...)
	}

	return uniqueAddressInfos(allAddressInfos), nil
}

func scrapeTarget(target string) ([]AddressInfo, error) {
	if cachedResult, ok := targetCache.Get(target); ok {
		return cachedResult.([]AddressInfo), nil
	}

	content, err := fetchHTMLContent(target)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch data from %s: %v", target, err)
	}

	addressInfos := findAddressInfos(content, target, "html", target)
	scripts := extractScripts(content)

	scriptInfos, err := processScripts(target, scripts)
	if err != nil {
		return nil, err
	}

	addressInfos = append(addressInfos, scriptInfos...)

	targetCache.Set(target, addressInfos)

	return addressInfos, nil
}

func processScripts(target string, scripts []string) ([]AddressInfo, error) {
	targetTLD, err := getTLD(target)
	if err != nil {
		return nil, err
	}

	var wg sync.WaitGroup
	scriptInfosChan := make(chan []AddressInfo, len(scripts))

	for _, script := range scripts {
		wg.Add(1)
		go func(script string) {
			defer wg.Done()
			scriptInfos, err := processScript(target, script, targetTLD)
			if err != nil {
				log.Printf("Error processing script %s: %v", script, err)
				return
			}
			scriptInfosChan <- scriptInfos
		}(script)
	}

	go func() {
		wg.Wait()
		close(scriptInfosChan)
	}()

	var allScriptInfos []AddressInfo
	for scriptInfos := range scriptInfosChan {
		allScriptInfos = append(allScriptInfos, scriptInfos...)
	}

	return allScriptInfos, nil
}

func processScript(target, script, targetTLD string) ([]AddressInfo, error) {
	fullURL, err := resolveURL(target, script)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve script URL %s: %v", script, err)
	}

	scriptURL, err := url.Parse(fullURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse script URL %s: %v", fullURL, err)
	}

	scriptHostname := scriptURL.Hostname()
	if contains(blacklistHostnames, scriptHostname) {
		return nil, nil
	}

	scriptTLD, err := getTopLevelDomain(scriptHostname)
	if err != nil {
		return nil, fmt.Errorf("failed to get TLD for script %s: %v", fullURL, err)
	}

	if scriptTLD != targetTLD {
		return nil, nil
	}

	scriptContent, err := getScriptContent(fullURL)
	if err != nil {
		return nil, err
	}

	return findAddressInfos(scriptContent, fullURL, "script", target), nil
}

func getScriptContent(fullURL string) (string, error) {
	if cachedContent, ok := scriptCache.Get(fullURL); ok {
		return cachedContent.(string), nil
	}

	scriptContent, err := fetchScriptContent(fullURL)
	if err != nil {
		return "", fmt.Errorf("failed to fetch script content from %s: %v", fullURL, err)
	}
	scriptCache.Set(fullURL, scriptContent)

	return scriptContent, nil
}

func getTLD(target string) (string, error) {
	targetURL, err := url.Parse(target)
	if err != nil {
		return "", fmt.Errorf("failed to parse target URL %s: %v", target, err)
	}
	targetHostname := targetURL.Hostname()
	if contains(blacklistHostnames, targetHostname) {
		return "", fmt.Errorf("target hostname %s is blacklisted", targetHostname)
	}
	return getTopLevelDomain(targetHostname)
}
