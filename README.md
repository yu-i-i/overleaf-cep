<h1 align="center">
  <br>
  <a href="https://www.overleaf.com"><img src="doc/logo.png" alt="Overleaf" width="300"></a>
</h1>

<h4 align="center">An open-source online real-time collaborative LaTeX editor.</h4>

<p align="center">
  <a href="https://github.com/overleaf/overleaf/wiki">Wiki</a> •
  <a href="https://www.overleaf.com/for/enterprises">Server Pro</a> •
  <a href="#contributing">Contributing</a> •
  <a href="https://mailchi.mp/overleaf.com/community-edition-and-server-pro">Mailing List</a> •
  <a href="#authors">Authors</a> •
  <a href="#license">License</a>
</p>

<img src="doc/screenshot.png" alt="A screenshot of a project being edited in Overleaf Community Edition">
<p align="center">
  Figure 1: A screenshot of a project being edited in Overleaf Community Edition.
</p>

## Community Edition

[Overleaf](https://www.overleaf.com) is an open-source online real-time collaborative LaTeX editor. We run a hosted version at [www.overleaf.com](https://www.overleaf.com), but you can also run your own local version, and contribute to the development of Overleaf.

## Enterprise

If you want help installing and maintaining Overleaf in your lab or workplace, we offer an officially supported version called [Overleaf Server Pro](https://www.overleaf.com/for/enterprises). It also includes more features for security (SSO with LDAP or SAML), administration and collaboration (e.g. tracked changes). [Find out more!](https://www.overleaf.com/for/enterprises)

## Keeping up to date

Sign up to the [mailing list](https://mailchi.mp/overleaf.com/community-edition-and-server-pro) to get updates on Overleaf releases and development.

## Installation

We have detailed installation instructions in the [Overleaf Toolkit](https://github.com/overleaf/toolkit/).

<details>
<summary><h3>Sandboxed Compiles</h3></summary>

To enable sandboxed compiles, edit `docker-compose.override.yml` to include the following `volumes` and `environment` configuration options.

```yml
---
version: '2.2'
services:
    sharelatex:
        volumes:
            "${DOCKER_SOCKET_PATH}": "/var/run/docker.sock"
    
        environment:
            DOCKER_RUNNER: 'true'
            SANDBOXED_COMPILES: 'true'
            SANDBOXED_COMPILES_SIBLING_CONTAINERS: 'true'
            SANDBOXED_COMPILES_HOST_DIR: "${OVERLEAF_DATA_PATH}/data/compiles"
            SYNCTEX_BIN_HOST_PATH: "${OVERLEAF_DATA_PATH}/bin/synctex"
            TEXLIVE_IMAGE: "texlive/texlive:latest-full"
            TEX_LIVE_DOCKER_IMAGE: "texlive/texlive:latest-full"
```

Edit `overleaf-toolkit/config/overleaf.rc` to set the following configuration options to an appropriate value for your host machine.

```text
# Sibling Containers
# The following option is in comments to silence a built-in warning, will be enabled differently
# SIBLING_CONTAINERS_ENABLED=true
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

Note that `SIBLING_CONTAINERS_ENABLED` is commented out to silence the following warning that Overleaf prints at startup (the option is set in the docker-compose file instead):

> WARNING: SIBLING_CONTAINERS_ENABLED=true is not supported in Overleaf Community Edition.
>   Sibling containers are not available in Community Edition, which is intended for use in environments where all users are trusted. Community Edition is not appropriate for scenarios where isolation of users is required.
>   When not using Sibling containers, users have full read and write access to the 'sharelatex' container resources (filesystem, network, environment variables) when running LaTeX compiles.
>   Sibling containers are offered as part of our Server Pro offering and you can read more about the differences at https://www.overleaf.com/for/enterprises/features.
>   Falling back using insecure in-container compiles. Set SIBLING_CONTAINERS_ENABLED=false in config/overleaf.rc to silence this warning.

The above `docker-compose.override.yml` will compile documents in a fresh docker container that uses the `texlive/texlive:latest-full` image. This image is not automatically installed, and must be available on the system. Before starting overleaf, you can make it available on the host system as follows:

```sh
docker pull texlive/texlive:latest-full
```

</details>

## Upgrading

If you are upgrading from a previous version of Overleaf, please see the [Release Notes section on the Wiki](https://github.com/overleaf/overleaf/wiki#release-notes) for all of the versions between your current version and the version you are upgrading to.

## Overleaf Docker Image

This repo contains two dockerfiles, [`Dockerfile-base`](server-ce/Dockerfile-base), which builds the
`sharelatex/sharelatex-base` image, and [`Dockerfile`](server-ce/Dockerfile) which builds the
`sharelatex/sharelatex` (or "community") image.

The Base image generally contains the basic dependencies like `wget`, plus `texlive`.
We split this out because it's a pretty heavy set of
dependencies, and it's nice to not have to rebuild all of that every time.

The `sharelatex/sharelatex` image extends the base image and adds the actual Overleaf code
and services.

Use `make build-base` and `make build-community` from `server-ce/` to build these images.

We use the [Phusion base-image](https://github.com/phusion/baseimage-docker)
(which is extended by our `base` image) to provide us with a VM-like container
in which to run the Overleaf services. Baseimage uses the `runit` service
manager to manage services, and we add our init-scripts from the `server-ce/runit`
folder.


## Contributing

Please see the [CONTRIBUTING](CONTRIBUTING.md) file for information on contributing to the development of Overleaf.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2024.
