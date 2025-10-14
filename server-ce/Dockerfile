# ---------------------------------------------
# Overleaf Community Edition (overleaf/overleaf)
# ---------------------------------------------

ARG OVERLEAF_BASE_TAG=sharelatex/sharelatex-base:latest
FROM $OVERLEAF_BASE_TAG

WORKDIR /overleaf

# Add required source files
# -------------------------
ADD server-ce/genScript.js /overleaf/genScript.js
ADD server-ce/services.js /overleaf/services.js
ADD package.json package-lock.json /overleaf/
ADD libraries/ /overleaf/libraries/
ADD services/ /overleaf/services/

# Add npm patches
# -----------------------
ADD patches/ /overleaf/patches

# Install npm dependencies and build webpack assets
# ------------------------
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/overleaf/services/web/node_modules/.cache,id=server-ce-webpack-cache \
    --mount=type=tmpfs,target=/tmp true \
&&  node genScript install | bash \
&&  node genScript compile | bash

# Copy runit service startup scripts to its location
# --------------------------------------------------
ADD server-ce/runit /etc/service

# Copy runit global settings to its location
# ------------------------------------------
ADD server-ce/config/env.sh /etc/overleaf/env.sh

# Configure nginx
# ---------------
ADD server-ce/nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
ADD server-ce/nginx/overleaf.conf /etc/nginx/sites-enabled/overleaf.conf
ADD server-ce/nginx/clsi-nginx.conf /etc/nginx/sites-enabled/clsi-nginx.conf


# Configure log rotation
# ----------------------
ADD server-ce/logrotate/overleaf /etc/logrotate.d/overleaf
RUN chmod 644 /etc/logrotate.d/overleaf

# Configure cron tasks
# ----------------------
ADD server-ce/cron /overleaf/cron
ADD server-ce/config/crontab-history /etc/cron.d/crontab-history
RUN chmod 600 /etc/cron.d/crontab-history
ADD server-ce/config/crontab-deletion /etc/cron.d/crontab-deletion
RUN chmod 600 /etc/cron.d/crontab-deletion

# Copy Phusion Image startup and shutdown scripts to their locations
# ------------------------------------------------------------------
COPY server-ce/init_scripts/ /etc/my_init.d/
COPY server-ce/init_preshutdown_scripts/ /etc/my_init.pre_shutdown.d/

# Copy app settings files
# -----------------------
COPY server-ce/config/settings.js /etc/overleaf/settings.js

# Copy history-v1 files
# -----------------------
COPY server-ce/config/production.json /overleaf/services/history-v1/config/production.json
COPY server-ce/config/custom-environment-variables.json /overleaf/services/history-v1/config/custom-environment-variables.json

# Copy grunt thin wrapper
# -----------------------
ADD server-ce/bin/grunt /usr/local/bin/grunt
RUN chmod +x /usr/local/bin/grunt

# Copy history helper scripts
# ---------------------------
ADD server-ce/bin/flush-history-queues /overleaf/bin/flush-history-queues
RUN chmod +x /overleaf/bin/flush-history-queues
ADD server-ce/bin/force-history-resyncs /overleaf/bin/force-history-resyncs
RUN chmod +x /overleaf/bin/force-history-resyncs

# Copy Latexmkrc
# -----------------------
COPY server-ce/config/latexmkrc /usr/local/share/latexmk/LatexMk

# File that controls open|closed status of the site
# -------------------------------------------------
ENV SITE_MAINTENANCE_FILE="/etc/overleaf/site_status"
RUN touch $SITE_MAINTENANCE_FILE

# Set Environment Variables
# --------------------------------
ENV OVERLEAF_CONFIG=/etc/overleaf/settings.js

ENV WEB_API_USER="overleaf"
ENV ADMIN_PRIVILEGE_AVAILABLE="true"

ENV OVERLEAF_APP_NAME="Overleaf Community Edition"

ENV OPTIMISE_PDF="true"

# Phusion Image timeouts before sending SIGKILL to processes
# ----------------------------------------------------------
ENV KILL_PROCESS_TIMEOUT=55
ENV KILL_ALL_PROCESSES_TIMEOUT=55
ENV GRACEFUL_SHUTDOWN_DELAY_SECONDS=1

ENV NODE_ENV="production"
ENV LOG_LEVEL="info"

# Set environment variable for max upload zip file
# ------------------------------------------------
# Increase the zip content file from 300MB to 2000MB by default with an environment variable MAX_ZIP_CONTENT_SIZE that can be configured.
ENV MAX_ZIP_CONTENT_SIZE=2000
RUN sed -i 's/ONE_MEG \* 300/ONE_MEG \* process.env.MAX_ZIP_CONTENT_SIZE/g'  /overleaf/services/web/app/src/Features/Uploads/ArchiveManager.js

# Increase the zip upload file from 50MB to 1024MB by default with an environment variable MAX_ZIP_UPLOAD_SIZE that can be configured.
ENV MAX_ZIP_UPLOAD_SIZE=1024
RUN sed -i 's/client_max_body_size 50/client_max_body_size ${MAX_ZIP_UPLOAD_SIZE}/g' /etc/nginx/templates/nginx.conf.template
RUN sed -i 's/maxUploadSize: 50 \* 1024 \* 1024/maxUploadSize: process.env.MAX_ZIP_UPLOAD_SIZE \* 1024 \* 1024/g' /overleaf/services/web/config/settings.defaults.js
# For templating the nginx.conf file add the env MAX_ZIP_UPLOAD_SIZE !
RUN sed -i 's/${NGINX_WORKER_PROCESSES}/${NGINX_WORKER_PROCESSES} ${MAX_ZIP_UPLOAD_SIZE}/g' /etc/my_init.d/*_nginx_config_template.sh


EXPOSE 80

ENTRYPOINT ["/sbin/my_init"]
