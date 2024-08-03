# Ethereum Address Scraper

## Overview

The `/scrape` API is a web scraping endpoint built using Go and the Gin framework. It allows users to send a list of target URLs and retrieves Ethereum addresses from the HTML content and associated script files of those URLs. The API ensures that script URLs are processed only if their top-level domain matches the top-level domain of the target URL.

## Features

- Accepts a list of target URLs via a POST request or CLI.
- Fetches HTML content and associated scripts from each target URL.
- Extracts Ethereum addresses from both HTML content and script content.
- Ensures that script URLs are processed only if their top-level domain matches the target URL's top-level domain.
- Returns a flat list of unique Ethereum addresses with their sources (HTML or script) and associated target URLs.

## Dependencies
```sh
go get -u github.com/spf13/cobra
go get github.com/gin-gonic/gin
go get github.com/weppos/publicsuffix-go/publicsuffix
```

## Run via CLI

```sh
go run scrape.go https://example.com https://anotherexample.com
```

## Run via webserver

```sh
go run main.go
```

## Endpoint

### POST /scrape

#### Request

- **URL:** `/scrape`
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Body:**
  - `targets`: An array of strings, each representing a URL to be scraped. All URLs must start with `http://` or `https://`.

#### Response

- **Content-Type:** `application/json`
- **Body:**
  - `message`: A message indicating the status of the request.
  - `results`: An array of objects, each representing a unique Ethereum address found during the scraping process.
    - `address`: The Ethereum address.
    - `src`: The source URL where the address was found (either the HTML content or a script URL).
    - `type`: The type of content where the address was found (`html` or `script`).
    - `targets`: An array of target URLs that contain the address.