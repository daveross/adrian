package main

import (
	"fmt"
	"log"
	"net/http"

	adrianConfig "Adrian2.0/config"
	adrianFonts "Adrian2.0/fonts"
	adrianServer "Adrian2.0/server"

	"github.com/labstack/echo"
)

func main() {

	log.Println("Starting Adrian 2.0")
	log.Println("Loading adrian.yaml")
	config := adrianConfig.LoadConfig("./adrian.yaml")
	log.Println("Initializing web server")
	e := adrianServer.Instantiate(config)
	log.Println("Instantiating font watcher")
	adrianFonts.InstantiateWatcher("C:\\Users\\dave\\go")
	log.Println("Defining paths")
	e.GET("/", func(c echo.Context) error {
		return c.String(http.StatusOK, "Hello, World!")
	})

	log.Printf("Listening on port %d", config.Global.Port)
	e.Logger.Fatal(e.Start(fmt.Sprintf(":%d", config.Global.Port)))
}