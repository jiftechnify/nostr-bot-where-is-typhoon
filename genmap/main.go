package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/chai2010/webp"
	sm "github.com/flopp/go-staticmaps"
	"github.com/golang/geo/s2"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatalf("failed to load .env: %v", err)
	}
	publicBaseURL := os.Getenv("R2_BUCKET_PUBLIC_BASE_URL")

	r2Cli := initR2Cli()
	handler := &genMapHandler{r2Cli, publicBaseURL}

	http.Handle("POST /genmap", handler)

	log.Println("listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Print(err)
	}
}

type GenMapReq struct {
	TyphoonNumber string    `json:"typhoonNumber"`
	Validtime     time.Time `json:"validtime"`
	LatLng        []float64 `json:"latLng"`
}

type GenMapResp struct {
	URL string `json:"url"`
}

func mapImageName(req *GenMapReq, ext string) string {
	return fmt.Sprintf("%s/%s.%s", req.TyphoonNumber, req.Validtime.Format("200601021504"), ext)
}

type genMapHandler struct {
	r2Cli         *r2Cli
	publicBaseURL string
}

func (h *genMapHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req GenMapReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("failed to decode request: %+v", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	defer func() {
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
	}()

	log.Printf("genmap request: %v", req)

	if len(req.LatLng) != 2 {
		log.Printf("invalid latLng (%v)", req.LatLng)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	log.Print("generating map image...")
	img, err := generateMapImage(req.LatLng)
	if err != nil {
		log.Print(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	if err := webp.Encode(&buf, img, nil); err != nil {
		log.Print("failed to encode image: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	log.Print("uploading map image to R2 bucket...")
	imgPath := mapImageName(&req, "webp")
	if err := h.r2Cli.uploadFile(imgPath, &buf, "image/webp"); err != nil {
		log.Print(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	imgURL := fmt.Sprintf("%s/%s", h.publicBaseURL, imgPath)
	resp := GenMapResp{
		URL: imgURL,
	}
	log.Printf("uploading map image succeeded! (URL: %s)", imgURL)

	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("failed to write response: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	return
}

func generateMapImage(latLng []float64) (image.Image, error) {
	pos := s2.LatLngFromDegrees(latLng[0], latLng[1])

	ctx := sm.NewContext()
	ctx.SetSize(600, 450)
	ctx.SetZoom(6)

	marker := sm.NewMarker(
		pos,
		color.RGBA{255, 0, 0, 255},
		16.0,
	)
	ctx.AddObject(marker)

	img, err := ctx.Render()
	if err != nil {
		return nil, fmt.Errorf("failed to generate map image: %w", err)
	}
	return img, nil
}

type r2Cli struct {
	s3         *s3.Client
	bucketName string
}

func initR2Cli() *r2Cli {
	cfAccountID := os.Getenv("CF_ACCOUNT_ID")
	bucketName := os.Getenv("R2_BUCKET_NAME")

	// カスタム設定でセッションの作成
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("failed to load configuration, %v", err)
	}

	// S3クライアントの作成
	s3Cli := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfAccountID))
	})

	return &r2Cli{
		s3:         s3Cli,
		bucketName: bucketName,
	}
}

func (c *r2Cli) uploadFile(key string, r io.Reader, contentType string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucketName),
		Key:         aws.String(key),
		Body:        r,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("failed to upload image: %w", err)
	}
	return nil
}
