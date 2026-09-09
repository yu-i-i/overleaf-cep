import { OError } from '../../../../app/src/Features/Errors/Errors.js'

/**
 * PSH — captureRender (UI-R10 W8).
 *
 * Runs an UPSTREAM render-handler UNMODIFIED and captures the view locals
 * it would have rendered (by substituting a fake `res`). This is the
 * "import, don't edit" bridge that lets these shells reuse the exact
 * upstream locals computation without touching any upstream file.
 *
 * Usage:
 *   const cap = captureRender()
 *   await cap.run(UpstreamController.someHandler, req)
 *   if (cap.redirected) return res.redirect(cap.redirected)
 *   res.render('page-shells/my-view', cap.locals)
 */

function captureRender() {
  let capturedView = null
  let capturedLocals = null
  let redirectTarget = null

  const fakeRes = {
    // Many handlers touch res.locals (e.g. split tests) — provide a bag.
    locals: {},
    set() {
      return this
    },
    status() {
      return { json: () => fakeRes, send: () => fakeRes, redirect: (to) => { redirectTarget = to; return {} } }
    },
    json() {
      return fakeRes
    },
    send() {
      return fakeRes
    },
    redirect(to) {
      redirectTarget = to
      return {}
    },
    render(view, locals) {
      capturedView = view
      capturedLocals = locals
      return fakeRes
    },
  }

  return {
    /**
     * `handler(req, res, next)` — upstream convention. `next` is provided
     * for compatibility; shells do not rely on upstream error flow.
     */
    async run(handler, req) {
      await handler(req, fakeRes, () => {
        /* ignored: shells render from the captured locals */
      })
    },
    get view() {
      return capturedView
    },
    get locals() {
      return capturedLocals
    },
    get redirected() {
      return redirectTarget
    },
    ensureRendered() {
      if (!capturedView || capturedLocals === null) {
        throw new OError(
          500,
          'Page-shell bridge: upstream handler did not render a view'
        )
      }
      return { view: capturedView, locals: capturedLocals }
    },
  }
}

export default captureRender
