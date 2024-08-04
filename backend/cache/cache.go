package cache

import (
	"math/rand"
	"sync"
)

type FixedSizeCache struct {
	items        map[string]interface{}
	keys         []string
	mutex        sync.RWMutex
	maxCacheSize int
}

func NewFixedSizeCache(maxCacheSize int) *FixedSizeCache {
	return &FixedSizeCache{
		items:        make(map[string]interface{}),
		keys:         make([]string, 0, maxCacheSize),
		maxCacheSize: maxCacheSize,
	}
}

func (c *FixedSizeCache) Set(key string, value interface{}) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	if _, exists := c.items[key]; !exists {
		if len(c.keys) >= c.maxCacheSize {
			// Evict a random item
			evictIndex := rand.Intn(len(c.keys))
			evictKey := c.keys[evictIndex]
			delete(c.items, evictKey)
			c.keys[evictIndex] = c.keys[len(c.keys)-1]
			c.keys = c.keys[:len(c.keys)-1]
		}
		c.keys = append(c.keys, key)
	}
	c.items[key] = value
}

func (c *FixedSizeCache) Get(key string) (interface{}, bool) {
	c.mutex.RLock()
	defer c.mutex.RUnlock()

	value, exists := c.items[key]
	return value, exists
}
