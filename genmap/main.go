package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
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
)

func main() {
	startServer()
}

func startServer() {
	mapGen, err := initMapGen()
	if err != nil {
		log.Fatalf("failed to initialize mapGenerator: %v", err)
	}
	publicBaseURL := os.Getenv("R2_BUCKET_PUBLIC_BASE_URL")
	r2Cli := initR2Cli()
	handler := &genmapHandler{r2Cli, mapGen, publicBaseURL}

	http.Handle("POST /genmap", handler)
	http.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		return
	})

	log.Println("listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Print(err)
	}
}

type latLngDegrees []float64

func (l *latLngDegrees) UnmarshalJSON(data []byte) error {
	a := make([]float64, 0, 2)
	if err := json.Unmarshal(data, &a); err != nil {
		return fmt.Errorf("LatLng.UnmarshalJSON failed to unmarshal to []float64: %w", err)
	}
	if len(a) < 2 {
		return errors.New("LatLng.UnmarshalJSON array must have at least 2 elements")
	}
	*l = a[0:2]
	return nil
}

func (l latLngDegrees) ToRadian() s2.LatLng {
	return s2.LatLngFromDegrees([]float64(l)[0], []float64(l)[1])
}

type TCPosition struct {
	Center           latLngDegrees  `json:"center"`
	Track            tcTrack        `json:"track"`
	StormWarningArea *tcWarningArea `json:"stormWarningArea"`
	GaleWarningArea  *tcWarningArea `json:"galeWarningArea"`
}

type tcTrack struct {
	PreTyphoon []latLngDegrees `json:"preTyphoon"`
	Typhoon    []latLngDegrees `json:"typhoon"`
}

type tcWarningArea struct {
	Center latLngDegrees `json:"center"`
	Radius int           `json:"radius"`
}

type genmapReq struct {
	TyphoonNumber string    `json:"typhoonNumber"`
	Validtime     time.Time `json:"validtime"`
	TCPosition
}

type genmapResp struct {
	URL string `json:"url"`
}

func mapImageName(req *genmapReq, ext string) string {
	return fmt.Sprintf("%s/%s.%s", req.TyphoonNumber, req.Validtime.Format("200601021504"), ext)
}

type genmapHandler struct {
	r2Cli         *r2Cli
	mapGen        *mapGenerator
	publicBaseURL string
}

func (h *genmapHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req genmapReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("failed to decode request: %+v", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	defer func() {
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
	}()

	log.Printf("genmap request: %+v", req)

	if len(req.Center) != 2 {
		log.Printf("invalid latLng (%v)", req.Center)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	log.Print("generating map image...")
	img, err := h.mapGen.generate(req.TCPosition)
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
	resp := genmapResp{
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

//go:embed res/tc_center.png
var tcCenterPng []byte

type mapGenerator struct {
	centerIcon image.Image
}

func initMapGen() (*mapGenerator, error) {
	img, err := png.Decode(bytes.NewReader(tcCenterPng))
	if err != nil {
		return nil, fmt.Errorf("failed to decode image of center icon: %w", err)
	}
	return &mapGenerator{centerIcon: img}, nil
}

// warning area colors
var (
	colorStormAreaStroke = color.RGBA{255, 0, 0, 255}
	colorStormAreaFill   = color.RGBA{160, 0, 0, 160}

	colorGaleAreaStroke = color.RGBA{255, 255, 0, 255}
	colorGaleAreaFill   = color.RGBA{160, 160, 0, 160}
)

func (g *mapGenerator) generate(pos TCPosition) (image.Image, error) {
	ctx := sm.NewContext()
	ctx.SetSize(600, 450)
	ctx.SetCenter(pos.Center.ToRadian())

	// TODO: はみ出たときに表示が変になるので一旦表示しない
	// track := make([]s2.LatLng, 0, len(pos.Track.Typhoon))
	// for _, p := range pos.Track.Typhoon {
	// 	track = append(track, p.ToRadian())
	// }
	// trackPath := sm.NewPath(track, color.RGBA{0, 0, 255, 255}, 2)
	// ctx.AddObject(trackPath)

	if pos.GaleWarningArea != nil {
		gw := pos.GaleWarningArea
		galeArea := sm.NewCircle(gw.Center.ToRadian(), colorGaleAreaStroke, colorGaleAreaFill, float64(gw.Radius), 3)
		ctx.AddObject(galeArea)
	}
	if pos.StormWarningArea != nil {
		sw := pos.StormWarningArea
		stormArea := sm.NewCircle(sw.Center.ToRadian(), colorStormAreaStroke, colorStormAreaFill, float64(sw.Radius), 3)
		ctx.AddObject(stormArea)
	}

	iconW, iconH := g.centerIcon.Bounds().Dx(), g.centerIcon.Bounds().Dy()
	center := sm.NewImageMarker(pos.Center.ToRadian(), g.centerIcon, float64(iconW)/2, float64(iconH)/2)
	ctx.AddObject(center)

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

	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("failed to load configuration, %v", err)
	}

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

func genTest() {
	mapGen, err := initMapGen()
	if err != nil {
		log.Fatalf("failed to initialize mapGenerator: %v", err)
	}
	img, err := mapGen.generate(TCPosition{
		Center:           latLngDegrees{18.5, 118.6},
		StormWarningArea: nil,
		GaleWarningArea:  &tcWarningArea{Center: latLngDegrees{18.5, 118.6}, Radius: 277800},
	})
	if err != nil {
		log.Fatalf("failed to generate: %v", err)
	}
	f, _ := os.Create("gentest.webp")
	defer f.Close()

	_ = webp.Encode(f, img, nil)
}
