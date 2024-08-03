#!/bin/bash
docker build -t api-server . && docker run -d -p 8080:8080 api-server