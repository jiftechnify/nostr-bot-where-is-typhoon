FROM denoland/deno:debian-1.46.1

WORKDIR /app

COPY . .

# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "-A", "--unstable-temporal", "--unstable-cron", "main.ts"]
