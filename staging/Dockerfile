# What test.mapsofmaking.org serves (staging/README.md): the tour, the dry run, a landing page.
# Static files behind nginx, like the app's own image; nothing of the app is in it.
# Build from the repo root: docker build -f staging/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY public/onboarding.ttl public/onboarding.ttl
COPY staging staging
# The commit the tree is read from, shown in the dry run's designer view.
ARG REVISION=local
RUN TREE_REV=$REVISION node staging/build.mjs /out

FROM nginx:1.29-alpine
COPY --from=build /out /usr/share/nginx/html
# 127.0.0.1, not localhost: busybox resolves localhost to ::1 first, and nginx listens on IPv4 only.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
