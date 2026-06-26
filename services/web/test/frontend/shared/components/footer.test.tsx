import React from 'react'
import ThinFooter from '../../../../frontend/js/shared/components/footer/thin-footer'

describe('<ThinFooter />', function () {
    it('renders raw HTML image tags in footer items without a URL', function () {
        cy.mount(
            <ThinFooter
                showPoweredBy={false}
                subdomainLang={{}}
                translatedLanguages={{}}
                leftItems={[{ text: '<img src="/test-logo.png" alt="Logo" />' }]}
                rightItems={[]}
            />
        )

        cy.get('footer.site-footer img[alt="Logo"]').should('exist')
    })

    it('renders raw HTML inside a footer link when URL is provided', function () {
        cy.mount(
            <ThinFooter
                showPoweredBy={false}
                subdomainLang={{}}
                translatedLanguages={{}}
                leftItems={[
                    {
                        text: '<img src="/test-logo.png" alt="Logo" />',
                        url: '/foo',
                    },
                ]}
                rightItems={[]}
            />
        )

        cy.get('footer.site-footer a[href="/foo"] img[alt="Logo"]').should('exist')
    })
})
