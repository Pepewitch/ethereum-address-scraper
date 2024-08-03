package cli

import (
    "encoding/json"
    "fmt"
    "log"
    "os"

    "backend/core"
)

func RunCLI() {
    if len(os.Args) < 2 {
        log.Fatalf("Usage: go run scraper.go url1 url2 ...")
    }

    targets := os.Args[1:]
    results, err := core.Scrape(targets)
    if err != nil {
        log.Fatalf("Failed to scrape targets: %v", err)
    }

    jsonResults, err := json.MarshalIndent(results, "", "  ")
    if err != nil {
        log.Fatalf("Failed to marshal results: %v", err)
    }

    fmt.Println(string(jsonResults))
}
