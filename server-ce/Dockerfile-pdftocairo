# replacement for quay.io/sharelatex/pdftocairo:24.02 (clsitex PDF→JPEG)
#
# ALIASES: pdftocairo-ol:25.12.0
#
# alpine:3.24 with poppler (25.12.0, >= 24.02 required by CLSI).
#
# Why: CLSI convertPDFToJPEG runs `pdftocairo -jpeg ...` against this image
# for preview (794px, q90) and thumbnail (190px, q50) JPEGs of compiled PDFs.
#
# The SaaS image is Ubuntu-based; alpine 3.24's poppler 25.12.0 covers exactly
# the flags CLSI uses (-jpeg -jpegopt -singlefile -scale-to-x -scale-to-y), and
# the image is tiny.
#
# images/pandoc-amd64/Dockerfile is the sibling (pandoc/core + zip). Same pattern:
# ENTRYPOINT [] because CLSI docker-runs with an explicit command (no
# --entrypoint override).

FROM alpine:3.24

ENTRYPOINT []

RUN apk update \
 && apk add --no-cache poppler-utils \
 && rm -rf /var/cache/apk/*
