import '@/marketing'
import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import { postJSON } from '@/infrastructure/fetch-json'
import UserActivateRegister from '../components/user-activate-register'

interface User {
  id: string
  lastName: string
  firstName: string
  email: string
  isAdmin: boolean
}

interface Notification {
  type: 'success' | 'error'
  message: string
}

function UserList() {
  const [users, setUsers] = useState<User[]>([])
  const [sort, setSort] = useState<{ column: keyof User; ascending: boolean }>({ 
    column: 'lastName', 
    ascending: true 
  })
  const [notification, setNotification] = useState<Notification | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [updatingAdminId, setUpdatingAdminId] = useState<string | null>(null)

  useEffect(() => {
    const meta = document.querySelector('meta[name="ol-userlist"]')
    if (meta) {
      try {
        const data = JSON.parse(meta.getAttribute('content') || '[]')
        setUsers(data)
      } catch (err) {
        console.error('Failed to parse user list:', err)
      }
    }
  }, [])

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  const sortedUsers = [...users].sort((a, b) => {
    const valA = String(a[sort.column]).toLowerCase()
    const valB = String(b[sort.column]).toLowerCase()
    return sort.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA)
  })

  function handleSort(column: keyof User) {
    setSort(prev => ({
      column,
      ascending: prev.column === column ? !prev.ascending : true,
    }))
  }

  async function handleAdminToggle(user: User) {
    const newAdminStatus = !user.isAdmin
    setUpdatingAdminId(user.id)

    try {
      const data = await postJSON(`/admin/user/${user.id}/admin`, {
        body: { isAdmin: newAdminStatus },
      })

      setUsers(prevUsers =>
        prevUsers.map(u =>
          u.id === user.id ? { ...u, isAdmin: newAdminStatus } : u
        )
      )
      setNotification({
        type: 'success',
        message: data.message || 'Admin status updated successfully',
      })
    } catch (error: any) {
      console.error('Error updating admin status:', error)
      setNotification({
        type: 'error',
        message: error.message || error.info?.message || 'Failed to update admin status',
      })
    } finally {
      setUpdatingAdminId(null)
    }
  }

  async function handleDelete(user: User) {
    const confirmed = window.confirm(
      `Are you sure you want to delete user "${user.firstName} ${user.lastName}" (${user.email})?\n\nThis will delete the user and all their projects. This action cannot be undone.`
    )

    if (!confirmed) return

    setDeletingUserId(user.id)

    try {
      const data = await postJSON(`/admin/user/${user.id}/delete`, {
        body: {},
      })

      setUsers(prevUsers => prevUsers.filter(u => u.id !== user.id))
      setNotification({
        type: 'success',
        message: data.message || 'User deleted successfully',
      })
    } catch (error: any) {
      console.error('Error deleting user:', error)
      setNotification({
        type: 'error',
        message: error.message || error.info?.message || 'Failed to delete user',
      })
    } finally {
      setDeletingUserId(null)
    }
  }

  if (users.length === 0) return null

  return (
    <div className="card" style={{ marginTop: '2rem' }}>
      <div className="card-body">
        <h3 className="card-title">Registered Users ({users.length})</h3>
        
        {notification && (
          <div
            className={`alert ${
              notification.type === 'success' ? 'alert-success' : 'alert-danger'
            } alert-dismissible fade show`}
            role="alert"
          >
            {notification.message}
            <button
              type="button"
              className="close"
              onClick={() => setNotification(null)}
              aria-label="Close"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-striped table-hover">
            <thead>
              <tr>
                {(['lastName', 'firstName', 'email'] as const).map(col => (
                  <th
                    key={col}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort(col)}
                  >
                    {col === 'lastName'
                      ? 'Family Name'
                      : col === 'firstName'
                      ? 'Given Name'
                      : 'Email'}{' '}
                    <span className="text-muted">
                      {sort.column === col ? (sort.ascending ? '▼' : '▲') : ''}
                    </span>
                  </th>
                ))}
                <th style={{ width: '120px', textAlign: 'center' }}>Admin</th>
                <th style={{ width: '100px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((u, i) => (
                <tr key={i}>
                  <td>{u.lastName}</td>
                  <td>{u.firstName}</td>
                  <td>{u.email}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={u.isAdmin}
                      onChange={() => handleAdminToggle(u)}
                      disabled={updatingAdminId === u.id}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(u)}
                      disabled={deletingUserId === u.id}
                    >
                      {deletingUserId === u.id ? (
                        <>
                          <span
                            className="spinner-border spinner-border-sm"
                            role="status"
                            aria-hidden="true"
                            style={{ marginRight: '5px' }}
                          />
                          Deleting...
                        </>
                      ) : (
                        'Delete'
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const container = document.getElementById('user-activate-register-container')
if (container) {
  const root = createRoot(container)
  root.render(
    <>
      <UserActivateRegister />
      <UserList />
    </>
  )
}

