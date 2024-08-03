package api

import (
	"backend/core"
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/gin-gonic/gin"
)

type TargetsRequest struct {
	Targets []string `json:"targets" binding:"required"`
}

func RunServer() {
	router := gin.Default()

	// Add CORS middleware
	router.Use(func(c *gin.Context) {
		allowedOrigins := []string{"http://localhost:5173", "https://ethereum-address-scraper.web.app", "https://ethereum-address-scraper.firebaseapp.com"}
		origin := c.Request.Header.Get("Origin")

		if origin != "" {
			for _, allowedOrigin := range allowedOrigins {
				if origin == allowedOrigin {
					c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
					break
				}
			}
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	var firebaseApp *firebase.App
	var auth *auth.Client
	ctx := context.Background()
	isProduction := os.Getenv("APP_ENV") == "production"
	if isProduction {
		var err error
		firebaseApp, err = firebase.NewApp(ctx, &firebase.Config{
			ProjectID: "ethereum-address-scraper",
		})
		if err != nil {
			log.Fatalf("error initializing app: %v\n", err)
			panic(err)
		}
		auth, err = firebaseApp.Auth(ctx)
		if err != nil {
			log.Fatalf("error initializing auth: %v\n", err)
			panic(err)
		}
	}

	router.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	router.POST("/scrape", func(c *gin.Context) {
		var request TargetsRequest

		// Check for authorization headers if in production
		if isProduction {
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Authorization header required",
				})
				return
			}

			// If Authorization headers is not starting with "Bearer ", return 401
			if !strings.HasPrefix(authHeader, "Bearer ") {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Authorization header must be a Bearer Token",
				})
				return
			}

			// strip "Bearer " from the beginning of the string
			authHeader = strings.TrimPrefix(authHeader, "Bearer ")

			_, err := auth.VerifyIDToken(ctx, authHeader)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid token",
				})
				return
			}
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
