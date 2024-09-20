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
  Figure 1: A screenshot of a project being edited in extended Overleaf Community Edition.
</p>

## Community Edition

[Overleaf](https://www.overleaf.com) is an open-source online real-time collaborative LaTeX editor. Overleaf runs a hosted version at [www.overleaf.com](https://www.overleaf.com), but you can also run your own local version, and contribute to the development of Overleaf.

## Extended Community Edition

The present "extended" version of Overleaf CE includes LDAP authentication and enhanced collaboration features such as tracked changes and comments.

## Enterprise

If you want help installing and maintaining Overleaf in your lab or workplace, Overleaf an officially supported version called [Overleaf Server Pro](https://www.overleaf.com/for/enterprises).

## Installation

Detailed installation instructions can be found in the [Overleaf Toolkit](https://github.com/overleaf/toolkit/).
To run a custom image, add a file named docker-compose.override.yml with the following or similar content into the ./toolkit/config directory:

```
---
version: '2.2'
services:
    sharelatex:
        image: sharelatex/sharelatex:ldap-tc
```

## LDAP Configuration

Internally, Overleaf LDAP uses the [passport-ldapauth](https://github.com/vesse/passport-ldapauth) library. Most of these configuration options are passed through to the `server` config object which is used to configure `passport-ldapauth`. If you are having issues configuring LDAP, it is worth reading the README for `passport-ldapauth` to get a feel for the configuration it expects.

### Environment Variables

- `OVERLEAF_LDAP_URL` **(required)** =
    Url of the LDAP server,
    E.g., 'ldaps://ldap.example.com:636' (LDAP over SSL), 'ldap://ldap.example.com:389' (unencrypted, or LDAP over TLS).

- `OVERLEAF_LDAP_EMAIL_ATT` =
  The email attribute the LDAP server will return, defaults to 'mail'

- `OVERLEAF_LDAP_FIRST_NAME_ATT` =
  The property name holding the first name of the user which is used in the application, usually 'givenName'

- `OVERLEAF_LDAP_LAST_NAME_ATT` =
  The property name holding the family name of the user which is used in the application, usually 'sn'

- `OVERLEAF_LDAP_NAME_ATT` =
  The property name holding the full name of the user, usually 'cn'. If either of the two previous variables is not defined,
  the first and/or last name of the user is extracted from this variable. Otherwise, it is not used.

- `OVERLEAF_LDAP_PLACEHOLDER` =
  The placeholder for the login form, defaults to 'Username'

- `OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN` =
  If set to 'true', will update the LDAP user first_name and last_name field on each login, and turn off the user-details form on /user/settings
  page for LDAP users. Otherwise, details will be fetched only on first login.

- `OVERLEAF_LDAP_BIND_DN` =
   Optional. The distinguished name of the LDAP user that should be used for the LDAP connection
   (this user should be able to search/list accounts on the LDAP server),
   e.g., 'cn=ldap_reader,dc=example,dc=com'. If not defined, anonymous binding is used.

- `OVERLEAF_LDAP_BIND_CREDENTIALS` =
    Password for `OVERLEAF_LDAP_BIND_DN`.

- `OVERLEAF_LDAP_BIND_PROPERTY` =
    Optional, default 'dn'. Property of the user to bind against the client.

- `OVERLEAF_LDAP_SEARCH_BASE` **(required)** =
    The base DN from which to search for users.
     E.g., 'ou=people,dc=example,dc=com'

- `OVERLEAF_LDAP_SEARCH_FILTER` =
    LDAP search filter with which to find a user by username, e.g.,
    '(|(uid={{username}})(mail={{username}}))'. Use the literal '{{username}}' to have the
    given username be interpolated in for the LDAP search. If you are using Active Directory then the
    search filter '(sAMAccountName={{username}})' may be more appropriate.

- `OVERLEAF_LDAP_SEARCH_SCOPE` =
    Optional, default 'sub'. Scope of the search is one of 'base', 'one', or 'sub'.

- `OVERLEAF_LDAP_SEARCH_ATTRIBUTES` =
    Optional, default all. Json array of attributes to fetch from LDAP server, e.g., '["uid", "mail", "givenName", "sn"]'

- `OVERLEAF_LDAP_STARTTLS` =
    If 'true', LDAP over TLS is used.

- `OVERLEAF_LDAP_TLS_OPTS_CA_PATH` =
    A JSON array of paths to the CA file for TLS, must be accessible to the docker container.
    E.g., '["/var/one.pem", "/var/two.pem"]'

- `OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH` =
     If 'true', the server certificate is verified against the list of supplied CAs.

- `OVERLEAF_LDAP_CACHE` =
    Optional. If 'true', then up to 100 credentials at a time will be cached for 5 minutes.

- `OVERLEAF_LDAP_TIMEOUT` =
    Optional, default Infinity. How long the client should let
    operations live for before timing out.

- `OVERLEAF_LDAP_CONNECT_TIMEOUT` =
    Optional, default is up to the OS. How long the client should wait
    before timing out on TCP connections.

The next 5 variables are used to determine if the user has admin rights.

- `OVERLEAF_LDAP_ADMIN_SEARCH_BASE` =
    Optional. Specifies the base DN from which to start searching for the admin group. If this variable is defined,
    `OVERLEAF_LDAP_ADMIN_SEARCH_FILTER` must also be defined for the search to function properly.

- `OVERLEAF_LDAP_ADMIN_SEARCH_FILTER` =
    Optional. Defines the LDAP search filter used to identify the admin group. The placeholder '{{dn}}' within the filter
    is replaced with the value of the property specified by `OVERLEAF_LDAP_ADMIN_DN_PROPERTY`. The placeholder '{{username}}' is also supported.

- `OVERLEAF_LDAP_ADMIN_DN_PROPERTY` =
    Optional, defaults to 'dn'. Specifies the property of the user object that will replace the '{{dn}}' placeholder
    in the `OVERLEAF_LDAP_ADMIN_SEARCH_FILTER`.

- `OVERLEAF_LDAP_ADMIN_SEARCH_SCOPE` =
    Optional, defaults to 'sub'. The scope of the LDAP search, which can be one of 'base', 'one', or 'sub'.

- `OVERLEAF_LDAP_UPDATE_ADMIN_ON_LOGIN` =
    Optional, default 'false'. If 'true', the user's admin status is updated on each login. Otherwise, the admin status is set only on the first login.

#### Example:

In the following example admins are members of a group 'admins', the objectClass of the entry 'admins' is 'groupOfNames':

    OVERLEAF_LDAP_ADMIN_SEARCH_BASE='cn=admins,ou=group,dc=example,dc=com'
    OVERLEAF_LDAP_ADMIN_SEARCH_FILTER='(member={{dn}})'

In the following example admins are members of a group 'admins', the objectClass of the entry 'admins' is 'posixGroup':

    OVERLEAF_LDAP_ADMIN_SEARCH_BASE='cn=admins,ou=group,dc=example,dc=com'
    OVERLEAF_LDAP_ADMIN_SEARCH_FILTER='(memberUid={{username}})'

In the following example admins are users with UNIX gid=1234:

    OVERLEAF_LDAP_ADMIN_SEARCH_BASE='ou=people,dc=example,dc=com'
    OVERLEAF_LDAP_ADMIN_SEARCH_FILTER='(&(gidNumber=1234)(uid={{username}}))'

The next 5 variables are used to configure how user contacts are retrieved from the LDAP server.

- `OVERLEAF_LDAP_CONTACTS_SEARCH_BASE` =
    Optional. Specifies the base DN from which to start searching for the contacts. Defauls to `OVERLEAF_LDAP_SEARCH_BASE`.

- `OVERLEAF_LDAP_CONTACTS_SEARCH_SCOPE` =
    Optional, default 'sub'. Scope of the search is one of 'base', 'one', or 'sub'.

- `OVERLEAF_LDAP_CONTACTS_FILTER` =
    Optional. The filter used to search for users in the LDAP server to be loaded into contacts. The placeholder '{{userProperty}}' within the filter is replaced with the value of
    the property specified by `OVERLEAF_LDAP_CONTACTS_PROPERTY` from the LDAP user initiating the search. If not defined, no users are retrieved from the LDAP server into contacts.

- `OVERLEAF_LDAP_CONTACTS_PROPERTY` =
    Optional. Specifies the property of the user object that will replace the '{{userProperty}}' placeholder in the `OVERLEAF_LDAP_CONTACTS_FILTER`.

- `OVERLEAF_LDAP_CONTACTS_NON_LDAP_VALUE` =
    Optional. Specifies the value of the `OVERLEAF_LDAP_CONTACTS_PROPERTY` if the search is initiated by a non-LDAP user. If this variable is not defined, the resulting filter
    will match nothing. The value '*' can be used as a wildcard.

#### Example:

    OVERLEAF_LDAP_CONTACTS_FILTER=(gidNumber={{userProperty}})
    OVERLEAF_LDAP_CONTACTS_PROPERTY=gidNumber
    OVERLEAF_LDAP_CONTACTS_NON_LDAP_VALUE=1000

The above example results in loading into the contacts of the current LDAP user all LDAP users who have the same UNIX gid. Non-LDAP users will have all LDAP users with UNIX gid=1000 in their contacts.

#### Sample variables.env file

```
OVERLEAF_APP_NAME="Our Overleaf Instance"

ENABLED_LINKED_FILE_TYPES=project_file,project_output_file

# Enables Thumbnail generation using ImageMagick
ENABLE_CONVERSIONS=true

# Disables email confirmation requirement
EMAIL_CONFIRMATION_DISABLED=true

## Nginx
# NGINX_WORKER_PROCESSES=4
# NGINX_WORKER_CONNECTIONS=768

## Set for TLS via nginx-proxy
# OVERLEAF_BEHIND_PROXY=true
# OVERLEAF_SECURE_COOKIE=true

OVERLEAF_SITE_URL=http://overleaf.example.com
OVERLEAF_NAV_TITLE=Our Overleaf Instance
# OVERLEAF_HEADER_IMAGE_URL=http://somewhere.com/mylogo.png
OVERLEAF_ADMIN_EMAIL=support@example.com

OVERLEAF_LEFT_FOOTER=[{"text": "Contact your support team", "url": "mailto:support@example.com"}]
OVERLEAF_RIGHT_FOOTER=[{"text":"Hello, I am on the Right", "url":"https://github.com/yu-i-i/overleaf-cep"}]

OVERLEAF_EMAIL_FROM_ADDRESS=team@example.com
OVERLEAF_EMAIL_SMTP_HOST=smtp.example.com
OVERLEAF_EMAIL_SMTP_PORT=587
OVERLEAF_EMAIL_SMTP_SECURE=false
# OVERLEAF_EMAIL_SMTP_USER=
# OVERLEAF_EMAIL_SMTP_PASS=
# OVERLEAF_EMAIL_SMTP_NAME=
OVERLEAF_EMAIL_SMTP_LOGGER=false
OVERLEAF_EMAIL_SMTP_TLS_REJECT_UNAUTH=true
OVERLEAF_EMAIL_SMTP_IGNORE_TLS=false
OVERLEAF_CUSTOM_EMAIL_FOOTER=This system is run by department x

OVERLEAF_PROXY_LEARN=true

#################
## LDAP for CE ##
#################

EXTERNAL_AUTH=ldap
OVERLEAF_LDAP_URL=ldap://ldap.example.com:389
OVERLEAF_LDAP_STARTTLS=true
OVERLEAF_LDAP_TLS_OPTS_CA_PATH=["/etc/ssl/certs/MyCACert.pem"]
OVERLEAF_LDAP_SEARCH_BASE=ou=people,dc=example,dc=com
OVERLEAF_LDAP_SEARCH_FILTER=(|(uid={{username}})(mail={{username}}))
OVERLEAF_LDAP_BIND_DN=cn=ldap_reader,dc=example,dc=com
OVERLEAF_LDAP_BIND_CREDENTIALS=GoodNewsEveryone
OVERLEAF_LDAP_EMAIL_ATT=mail
OVERLEAF_LDAP_FIRST_NAME_ATT=givenName
OVERLEAF_LDAP_LAST_NAME_ATT=sn
# OVERLEAF_LDAP_NAME_ATT=cn
OVERLEAF_LDAP_SEARCH_ATTRIBUTES=["uid", "sn", "givenName", "mail"]

OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN=true

OVERLEAF_LDAP_PLACEHOLDER='Username or email address'

OVERLEAF_LDAP_ADMIN_SEARCH_BASE=cn=admins,ou=group,dc=example,dc=com
OVERLEAF_LDAP_ADMIN_SEARCH_FILTER='(member={{dn}})'
OVERLEAF_LDAP_UPDATE_ADMIN_ON_LOGIN=false

OVERLEAF_LDAP_CONTACTS_FILTER=(gidNumber={{userProperty}})
OVERLEAF_LDAP_CONTACTS_PROPERTY=gidNumber
OVERLEAF_LDAP_CONTACTS_NON_LDAP_VALUE='*'
```

## Overleaf Docker Image

This repo contains two dockerfiles, [`Dockerfile-base`](server-ce/Dockerfile-base), which builds the
`sharelatex/sharelatex-base` image, and [`Dockerfile`](server-ce/Dockerfile) which builds the
`sharelatex/sharelatex` (or "community") image.

The Base image generally contains the basic dependencies like `wget` and
`aspell`, plus `texlive`. We split this out because it's a pretty heavy set of
dependencies, and it's nice to not have to rebuild all of that every time.

The `sharelatex/sharelatex` image extends the base image and adds the actual Overleaf code
and services.

Use `make build-base` and `make build-community` from `server-ce/` to build these images.

We use the [Phusion base-image](https://github.com/phusion/baseimage-docker)
(which is extended by our `base` image) to provide us with a VM-like container
in which to run the Overleaf services. Baseimage uses the `runit` service
manager to manage services, and we add our init-scripts from the `server-ce/runit`
folder.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)
<br>
LDAP authentication for CE: [yu-i-i](https://github.com/yu-i-i/overleaf-cep)

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2024.
