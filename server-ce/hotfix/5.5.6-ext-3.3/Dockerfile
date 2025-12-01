FROM overleafcep/sharelatex:5.5.6-ext-v3.2

# add normalize and sanitize to linked-url-proxy
COPY *.patch* .
RUN bash -ec 'for p in *.patch; do echo "=== Applying $p ==="; patch -p1 < "$p" && rm $p; done'  \
  &&  npm install als-normalize-urlpath@2.3.0 \
  && rm -f ./package.json.orig \
  ./services/history-v1/storage/scripts/back_fill_file_hash.mjs.orig \
  ./services/history-v1/test/acceptance/js/storage/back_fill_file_hash.test.mjs.orig \
  ./services/linked-url-proxy/app/js/LinkedUrlProxyController.mjs.orig \
  ./services/web/config/settings.defaults.js.orig \
  ./services/web/frontend/js/features/source-editor/components/toolbar/toolbar-items.tsx.orig \
  ./services/web/test/frontend/features/share-project-modal/components/share-project-modal.test.jsx.orig \
  ./services/web/package.json.orig \
  ./services/filestore/app.js.orig \
  ./package-lock.json.orig \
  ./package-lock.json.diff \
  /etc/my_init.d/100_make_overleaf_data_dirs.sh.orig \
  /etc/overleaf/settings.js.orig

