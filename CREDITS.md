# CREDITS

This project includes ideas and adapted code from several open-source projects.\
In most cases the original code has been modified, optimized, or extended.

## Symbol palette

The symbol palette feature is based on the original Overleaf implementation:

https://github.com/overleaf/web/tree/master/frontend/js/features/symbol-palette

The original code was slightly improved, particularly in the parts related to keyboard input.

## LDAP authentication

LDAP authentication was inspired by:

https://github.com/smhaller/ldap-overleaf-sl

The project provided the idea and part of the implementation for adding LDAP users to the user's contacts.

## Autocomplete of reference keys

Autocomplete of reference keys is based on:

https://github.com/lcpu-club/overleaf

The implementation largely follows the referenced code, except that a different `.bib` file parser is used.

## Real-time track changes and comments

The Track Changes and Comments feature exists largely in the original Overleaf codebase.\
The missing parts were implemented based on:

https://github.com/ertuil/overleaf

The referenced code was fixed, optimized, and extended.

## Sandboxed compiles

The Sandboxed Compiles feature was until recently largely present in the original Overleaf codebase.\
The missing parts were implemented in this project.

## Import file from external URL

The "From External URL" feature exists in the original Overleaf code.\
The missing proxy component was implemented in this project.

## Git integration

Git integration is based on:

https://github.com/ayaka-notes/overleaf-pro/tree/feat-git-bridge

The backend was completely rewritten.\
The frontend uses the referenced code, which was optimized and improved.

## Original Features

The following features are original work implemented in this project:

- Template Gallery
- Advanced administrator tools for managing user accounts and projects
- SAML authentication
- OpenID Connect authentication

## Acknowledgments

Thanks to the users of the project for valuable feedback, suggestions,
and help in identifying and fixing bugs.
