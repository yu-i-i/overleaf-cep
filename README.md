<h1 align="center">
  <br>
  <a href="https://www.overleaf.com"><img src="doc/logo.png" alt="Overleaf" width="300"></a>
</h1>

<h4 align="center">An open-source online real-time collaborative LaTeX editor.</h4>

<p align="center">
  <a href="https://github.com/yu-i-i/overleaf-cep/wiki">Wiki</a> •
  <a href="https://www.overleaf.com/for/enterprises">Server Pro</a> •
  <a href="#authors">Authors</a> •
  <a href="#license">License</a>
</p>

<img src="doc/screenshot.png" alt="A screenshot of a project being edited in Overleaf Extended Community Edition">
<p align="center">
  Figure 1: A screenshot of a project being edited in Overleaf Extended Community Edition.
</p>

## Community Edition

[Overleaf](https://www.overleaf.com) is an open-source online real-time collaborative LaTeX editor. Overleaf runs a hosted version at [www.overleaf.com](https://www.overleaf.com), but you can also run your own local version, and contribute to the development of Overleaf.

## Extended Community Edition

The present "extended" version of Overleaf CE includes:

- Template Gallery
- Sandboxed Compiles with TeX Live image selection
- LDAP authentication
- SAML authentication
- OpenID Connect authentication
- Real-time track changes and comments
- Autocomplete of reference keys
- Symbol Palette
- "From External URL" feature

> [!CAUTION]
> Overleaf Community Edition is intended for use in environments where **all** users are trusted. Community Edition is **not** appropriate for scenarios where isolation of users is required due to Sandbox Compiles not being available. When not using Sandboxed Compiles, users have full read and write access to the `sharelatex` container resources (filesystem, network, environment variables) when running LaTeX compiles. 
Therefore, in any environment where not all users can be fully trusted, it is strongly recommended to enable the Sandboxed Compiles feature available in the Extended Community Edition.

For more information on Sandbox Compiles check out Overleaf [documentation](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/server-pro-only-configuration/sandboxed-compiles).

## Enterprise

If you want help installing and maintaining Overleaf in your lab or workplace, Overleaf offers an officially supported version called [Overleaf Server Pro](https://www.overleaf.com/for/enterprises).

## Installation

Detailed installation instructions can be found in the [Overleaf Toolkit](https://github.com/overleaf/toolkit/).
Configuration details and release history for the Extended Community Edition can be found on the [Extended CE Wiki Page](https://github.com/yu-i-i/overleaf-cep/wiki).

## Overleaf Docker Image

This repo contains two dockerfiles, [`Dockerfile-base`](server-ce/Dockerfile-base), which builds the
`sharelatex/sharelatex-base:ext-ce` image, and [`Dockerfile`](server-ce/Dockerfile) which builds the
`sharelatex/sharelatex:ext-ce` image.

The Base image generally contains the basic dependencies like `wget`, plus `texlive`.
This is split out because it's a pretty heavy set of
dependencies, and it's nice to not have to rebuild all of that every time.

The `sharelatex/sharelatex` image extends the base image and adds the actual Overleaf code
and services.

Use `make build-base` and `make build-community` from `server-ce/` to build these images.

The [Phusion base-image](https://github.com/phusion/baseimage-docker)
(which is extended by the `base` image) provides a VM-like container
in which to run the Overleaf services. Baseimage uses the `runit` service
manager to manage services, and init scripts from the `server-ce/runit`
folder are added.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)  
[yu-i-i](https://github.com/yu-i-i/overleaf-cep) — Extensions for CE unless otherwise noted

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2025.
