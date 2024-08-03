package main

import (
    "github.com/gin-gonic/gin"
    "io/ioutil"
    "log"
    "net/http"
    "net/url"
    "regexp"
    "strings"
    "golang.org/x/net/html"
    "github.com/weppos/publicsuffix-go/publicsuffix"
)

// Define a struct to bind the JSON data
type TargetsRequest struct {
    Targets []string `json:"targets" binding:"required"`
}

type AddressInfo struct {
    Address string   `json:"address"`
    Src     string   `json:"src"`
    Type    string   `json:"type"`
    Targets []string `json:"targets"`
}

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
    resp, err := http.Get(scriptURL)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()
    body, err := ioutil.ReadAll(resp.Body)
    if err != nil {
        return "", err
    }
    return string(body), nil
}

// Function to fetch HTML content
func fetchHTMLContent(targetURL string) (string, error) {
    resp, err := http.Get(targetURL)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()
    body, err := ioutil.ReadAll(resp.Body)
    if err != nil {
        return "", err
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

func main() {
    // Create a new Gin router
    router := gin.Default()

    // Define a GET route
    router.GET("/ping", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "message": "pong",
        })
    })

    // Define a POST route for /scrape
    router.POST("/scrape", func(c *gin.Context) {
        var request TargetsRequest
        if err := c.ShouldBindJSON(&request); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "Invalid request",
            })
            return
        }

        // Custom validation for targets
        if len(request.Targets) == 0 {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "Targets array must have at least one URL",
            })
            return
        }

        for _, target := range request.Targets {
            if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
                c.JSON(http.StatusBadRequest, gin.H{
                    "error": "All targets must start with 'http://' or 'https://'",
                })
                return
            }
        }

        // Fetch data from each target URL
        var allAddressInfos []AddressInfo
        scriptCache := make(map[string]string)
        for _, target := range request.Targets {
            content, err := fetchHTMLContent(target)
            if err != nil {
                log.Printf("Failed to fetch data from %s: %v", target, err)
                continue
            }

            scripts := extractScripts(content)

            addressInfos := findAddressInfos(content, target, "html", target)

            targetURL, err := url.Parse(target)
            if err != nil {
                log.Printf("Failed to parse target URL %s: %v", target, err)
                continue
            }
            targetTLD, err := getTopLevelDomain(targetURL.Hostname())
            if err != nil {
                log.Printf("Failed to get TLD for target %s: %v", target, err)
                continue
            }

            for _, script := range scripts {
                fullURL, err := resolveURL(target, script)
                if err != nil {
                    log.Printf("Failed to resolve script URL %s: %v", script, err)
                    continue
                }
                scriptURL, err := url.Parse(fullURL)
                if err != nil {
                    log.Printf("Failed to parse script URL %s: %v", fullURL, err)
                    continue
                }
                scriptTLD, err := getTopLevelDomain(scriptURL.Hostname())
                if err != nil {
                    log.Printf("Failed to get TLD for script %s: %v", fullURL, err)
                    continue
                }
                if scriptTLD != targetTLD {
                    continue
                }

                // Check if the script content is already cached
                scriptContent, cached := scriptCache[fullURL]
                if !cached {
                    // Fetch the script content if not cached
                    scriptContent, err = fetchScriptContent(fullURL)
                    if err != nil {
                        log.Printf("Failed to fetch script content from %s: %v", fullURL, err)
                        continue
                    }
                    // Cache the fetched script content
                    scriptCache[fullURL] = scriptContent
                }

                addressInfos = append(addressInfos, findAddressInfos(scriptContent, fullURL, "script", target)...)
            }

            allAddressInfos = append(allAddressInfos, addressInfos...)
        }

        // Ensure allAddressInfos are unique by address, src, and type, and targets are unique
        uniqueAddressInfos := uniqueAddressInfos(allAddressInfos)

        // Return the results
        c.JSON(http.StatusOK, gin.H{
            "message": "Data fetched successfully",
            "results": uniqueAddressInfos,
        })
    })

    // Start the server
    router.Run(":8080") // Default listens and serves on 0.0.0.0:8080
}
