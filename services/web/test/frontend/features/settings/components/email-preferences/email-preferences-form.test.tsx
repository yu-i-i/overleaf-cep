import { expect } from 'chai'
import { fireEvent, screen, render } from '@testing-library/react'
import fetchMock from 'fetch-mock'
import EmailPreferencesForm from '../../../../../../frontend/js/features/settings/components/email-preferences/email-preferences-form'

describe('<EmailPreferencesForm />', function () {
  beforeEach(function () {
    window.metaAttributesCache.set('ol-userNotificationPreferences', {
      notificationEmailsEnabled: true,
      projectCommentReplyEmails: true,
      projectInviteEmails: true,
      muteAllNotifications: false,
    })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('shows notification preferences and send test email button', function () {
    render(<EmailPreferencesForm />)

    screen.getByRole('button', { name: 'Send a test email' })
    screen.getByLabelText('Receive notification emails')
    screen.getByLabelText('Project comments and replies')
    screen.getByLabelText('Project invite emails')
  })

  it('updates notification email preferences when toggling project comment/reply emails', async function () {
    const preferencesMock = fetchMock.post(
      '/user/notification-email-preferences',
      {
        status: 200,
        body: {
          notificationEmailsEnabled: true,
          projectCommentReplyEmails: false,
          projectInviteEmails: true,
        },
      }
    )
    render(<EmailPreferencesForm />)

    const checkbox = screen.getByLabelText('Project comments and replies')
    fireEvent.click(checkbox)

    expect(preferencesMock.callHistory.called()).to.be.true
    expect(preferencesMock.callHistory.calls().at(-1)?.url).to.equal(
      'https://www.test-overleaf.com/user/notification-email-preferences'
    )
  })

  it('updates notification email preferences when toggling project invite emails', async function () {
    const preferencesMock = fetchMock.post(
      '/user/notification-email-preferences',
      {
        status: 200,
        body: {
          notificationEmailsEnabled: true,
          projectCommentReplyEmails: true,
          projectInviteEmails: false,
        },
      }
    )
    render(<EmailPreferencesForm />)

    const checkbox = screen.getByLabelText('Project invite emails')
    fireEvent.click(checkbox)

    expect(preferencesMock.callHistory.called()).to.be.true
    expect(preferencesMock.callHistory.calls().at(-1)?.url).to.equal(
      'https://www.test-overleaf.com/user/notification-email-preferences'
    )
  })

  it('sends a test email when clicking the button', async function () {
    const testEmailMock = fetchMock.post('/user/send-test-email', {
      status: 200,
      body: { message: 'Email Sent' },
    })
    render(<EmailPreferencesForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Send a test email' }))

    expect(testEmailMock.callHistory.called()).to.be.true
    expect(testEmailMock.callHistory.calls().at(-1)?.url).to.equal(
      'https://www.test-overleaf.com/user/send-test-email'
    )
    await screen.findByText('Email Sent')
  })

  it('shows loading state while sending test email', async function () {
    let finishRequest: (value: any) => void = () => {}
    fetchMock.post(
      '/user/send-test-email',
      new Promise(resolve => (finishRequest = resolve))
    )
    render(<EmailPreferencesForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Send a test email' }))
    await screen.findByRole('button', { name: 'Sending…' })

    finishRequest({ status: 200, body: { message: 'Email Sent' } })
    await screen.findByText('Email Sent')
  })

  it('shows error notification on server error when sending test email', async function () {
    fetchMock.post('/user/send-test-email', 500)
    render(<EmailPreferencesForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Send a test email' }))
    await screen.findByText('Something went wrong. Please try again.')
  })
})
