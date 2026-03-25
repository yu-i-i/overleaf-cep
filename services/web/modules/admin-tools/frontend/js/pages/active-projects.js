document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('active-projects-container')
  const tabLink = document.querySelector('a[href="#active-projects"]')
  const tabPane = document.getElementById('active-projects')

  if (!container || !tabPane) return

  let isLoaded = false
  let isLoading = false

  function loadActiveProjects() {
    if (isLoaded || isLoading) return

    isLoading = true

    // show loading only if tab is visible
    if (tabPane.classList.contains('active')) {
      container.innerHTML = '<p class="text-muted">Loading...</p>'
    }

    fetch('/admin/active-projects')
      .then(res => res.json())
      .then(data => {
        container.innerHTML = renderTable(data)
        isLoaded = true
      })
      .catch(() => {
        container.innerHTML =
          '<p class="text-danger">Failed to load active projects</p>'
      })
      .finally(() => {
        isLoading = false
      })
  }

  // preload immediately when /admin page opens
  loadActiveProjects()

  // ensure data is loaded when tab is opened
  if (tabLink) {
    tabLink.addEventListener('shown.bs.tab', () => {
      if (!isLoaded) loadActiveProjects()
    })
  }
})

function renderTable(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return `
      <div class="alert alert-success">
        <span style="color: green;">✔</span>
        <strong> Great news!</strong>
        No projects are currently being edited.
      </div>
    `
  }

  const rows = data.map(project => {
    const owner = project.owner || {}
    const users = project.activeUsers || []

    const usersHtml = users.length
      ? `<ul class="list-unstyled mb-0">${users.map(u =>
          `<li><strong>${u.name}</strong>${u.email ? ` (${u.email})` : ''}</li>`
        ).join('')}</ul>`
      : '<em>None detected</em>'

    return `
      <tr>
        <td><a href="/project/${project.id}" target="_blank">${project.name}</a></td>
        <td>${owner.name || 'Unknown'}</td>
        <td>${
          owner.email
            ? `<a href="mailto:${owner.email}">${owner.email}</a>`
            : 'N/A'
        }</td>
        <td>${usersHtml}</td>
        <td>${project.connectionCount}</td>
      </tr>
    `
  }).join('')

  return `
    <p class="small">
      <strong>${data.length}</strong> project(s) currently being edited
    </p>

    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th>Project Name</th>
          <th>Owner</th>
          <th>Owner Email</th>
          <th>Active Users</th>
          <th>Connections</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}
