package api

import (
	"net/http"
	"os"
	"strings"

	"backend/core"

	"github.com/gin-gonic/gin"
)

type TargetsRequest struct {
	Targets []string `json:"targets" binding:"required"`
}

func RunServer() {
	router := gin.Default()

	router.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	router.POST("/scrape", func(c *gin.Context) {
		var request TargetsRequest

		// Check for authorization headers if in production
		if os.Getenv("APP_ENV") == "production" {
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Authorization header required",
				})
				return
			}
			// Add your authorization logic here
		}

		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request",
			})
			return
		}

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

		results, err := core.Scrape(request.Targets)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to scrape targets",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Data fetched successfully",
			"results": results,
		})
	})

	router.Run(":8080")
}
