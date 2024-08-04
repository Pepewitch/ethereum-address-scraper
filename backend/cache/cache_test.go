package cache

import (
	"testing"
)

func TestNewFixedSizeCache(t *testing.T) {
	cache := NewFixedSizeCache(5)
	if cache.maxCacheSize != 5 {
		t.Errorf("Expected max cache size of 5, got %d", cache.maxCacheSize)
	}
	if len(cache.items) != 0 {
		t.Errorf("Expected empty cache, got %d items", len(cache.items))
	}
}

func TestSetAndGet(t *testing.T) {
	cache := NewFixedSizeCache(3)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")
	cache.Set("key3", "value3")

	value, exists := cache.Get("key2")
	if !exists {
		t.Error("Expected key2 to exist in cache")
	}
	if value != "value2" {
		t.Errorf("Expected value2, got %v", value)
	}

	_, exists = cache.Get("nonexistent")
	if exists {
		t.Error("Expected nonexistent key to not exist in cache")
	}
}

func TestEviction(t *testing.T) {
	cache := NewFixedSizeCache(3)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")
	cache.Set("key3", "value3")
	cache.Set("key4", "value4")

	if len(cache.items) != 3 {
		t.Errorf("Expected 3 items in cache, got %d", len(cache.items))
	}

	evictedCount := 0
	for _, key := range []string{"key1", "key2", "key3"} {
		if _, exists := cache.Get(key); !exists {
			evictedCount++
		}
	}

	if evictedCount != 1 {
		t.Errorf("Expected 1 item to be evicted, got %d", evictedCount)
	}

	if _, exists := cache.Get("key4"); !exists {
		t.Error("Expected key4 to exist in cache")
	}
}

func TestOverwrite(t *testing.T) {
	cache := NewFixedSizeCache(3)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")
	cache.Set("key3", "value3")
	cache.Set("key2", "new_value2")

	value, exists := cache.Get("key2")
	if !exists {
		t.Error("Expected key2 to exist in cache")
	}
	if value != "new_value2" {
		t.Errorf("Expected new_value2, got %v", value)
	}

	if len(cache.items) != 3 {
		t.Errorf("Expected 3 items in cache, got %d", len(cache.items))
	}
}
