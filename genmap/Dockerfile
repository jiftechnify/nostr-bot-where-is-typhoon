FROM public.ecr.aws/docker/library/golang:1.23 AS build
WORKDIR /src
RUN --mount=type=bind,source=go.mod,target=go.mod \
    go mod download -x
RUN --mount=type=bind,target=. go build -o /bin/genmap .

FROM public.ecr.aws/docker/library/debian:bookworm
RUN apt-get update \ 
  && apt-get install -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /bin/genmap /bin/
EXPOSE 8080
ENTRYPOINT [ "/bin/genmap" ]

