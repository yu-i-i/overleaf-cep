# Overview

We assume that two files exist:

* logo.svg (short version of the logo)
* logo_full.svg (wide version of the logo with e.g. University of Somewhere)

# 1_convert.sh

It does a lot of converting logos from one format to another and scales & changes colors of the logo for producing the required set of files.

In the moment it mainly uses inkscape and imagemagick as tools.

# 2_install.sh

This script copies the files to the correct positions before compilation. I seperated the scripts, since you may want to check the logos beforehand. Or do changes by hand.
e.g. I don't like overleaf-a-ds-solution-mallard.svg as a long logo.

# 3_remove_branding_from_projectpage.sh

This script is a maintenance utility designed to modify the project list sidebar by removing specific branding elements from the frontend source code.

Target File: services/web/frontend/js/features/project-list/components/sidebar/sidebar-ds-nav.tsx

Action:  Removes the <div ... className="ds-nav-ds-name" ...>...</div> block

