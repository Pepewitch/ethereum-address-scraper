package main

import (
    "reflect"
    "testing"
)

func TestResolveURL(t *testing.T) {
    tests := []struct {
        base     string
        ref      string
        expected string
    }{
        {"https://example.com", "/script", "https://example.com/script"},
        {"https://example.com", "http://example.com/script", "http://example.com/script"},
        {"https://example.com", "http://apple.com/script", "http://apple.com/script"},
        {"https://example.com/path/", "script", "https://example.com/script"},
        {"https://example.com/path/", "./script", "https://example.com/script"},
        {"https://example.com/path/", "../script", "https://example.com/script"},
        {"https://example.com/path/", "//example.com/script", "https://example.com/script"},
        {"https://example.com", "#fragment", "https://example.com#fragment"},
    }

    for _, test := range tests {
        result, err := resolveURL(test.base, test.ref)
        if err != nil {
            t.Errorf("Unexpected error: %v", err)
        }
        if result != test.expected {
            t.Errorf("resolveURL(%s, %s) = %s; expected %s", test.base, test.ref, result, test.expected)
        }
    }
}

func TestFindAddressInfos(t *testing.T) {
    tests := []struct {
        content    string
        src        string
        contentType string
        target     string
        expected   []AddressInfo
    }{
        {
            "Here is an Ethereum address: 0x1234567890abcdef1234567890abcdef12345678",
            "https://example.com",
            "html",
            "https://example.com",
            []AddressInfo{
                {"0x1234567890abcdef1234567890abcdef12345678", "https://example.com", "html", []string{"https://example.com"}},
            },
        },
        {
            "Multiple addresses: 0x1111111111111111111111111111111111111111 and 0x2222222222222222222222222222222222222222",
            "https://example.com",
            "html",
            "https://example.com",
            []AddressInfo{
                {"0x1111111111111111111111111111111111111111", "https://example.com", "html", []string{"https://example.com"}},
                {"0x2222222222222222222222222222222222222222", "https://example.com", "html", []string{"https://example.com"}},
            },
        },
        {
            "No address here",
            "https://example.com",
            "html",
            "https://example.com",
            []AddressInfo{},
        },
    }

    for _, test := range tests {
        result := findAddressInfos(test.content, test.src, test.contentType, test.target)
        if !reflect.DeepEqual(result, test.expected) {
            if len(result) == 0 && len(test.expected) == 0 {
                // Consider both empty slices equal
                continue
            }
            t.Errorf("findAddressInfos(%s, %s, %s, %s) = %v; expected %v", test.content, test.src, test.contentType, test.target, result, test.expected)
        }
    }
}

func TestUniqueAddressInfos(t *testing.T) {
    tests := []struct {
        input    []AddressInfo
        expected []AddressInfo
    }{
        {
            []AddressInfo{
                {"0x1234567890abcdef1234567890abcdef12345678", "https://example.com", "html", []string{"https://example.com"}},
                {"0x1234567890abcdef1234567890abcdef12345678", "https://example.com", "html", []string{"https://example.com/page"}},
            },
            []AddressInfo{
                {"0x1234567890abcdef1234567890abcdef12345678", "https://example.com", "html", []string{"https://example.com", "https://example.com/page"}},
            },
        },
        {
            []AddressInfo{
                {"0x1111111111111111111111111111111111111111", "https://example.com", "html", []string{"https://example.com"}},
                {"0x2222222222222222222222222222222222222222", "https://example.com", "html", []string{"https://example.com"}},
                {"0x1111111111111111111111111111111111111111", "https://example.com", "html", []string{"https://example.com/page"}},
            },
            []AddressInfo{
                {"0x1111111111111111111111111111111111111111", "https://example.com", "html", []string{"https://example.com", "https://example.com/page"}},
                {"0x2222222222222222222222222222222222222222", "https://example.com", "html", []string{"https://example.com"}},
            },
        },
    }

    for _, test := range tests {
        result := uniqueAddressInfos(test.input)
        if !reflect.DeepEqual(result, test.expected) {
            t.Errorf("uniqueAddressInfos(%v) = %v; expected %v", test.input, result, test.expected)
        }
    }
}
