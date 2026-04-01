import React, { FC, useEffect, useRef, MutableRefObject } from 'react'

type Props = {
    value: string
    onChange: (latex: string) => void
    mathfieldRef: MutableRefObject<any>
    keyboardVisible: boolean
}

export const MathLiveInput: FC<Props> = ({ value, onChange, mathfieldRef, keyboardVisible }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const initialized = useRef(false)
    const fallback = useRef(false)

    useEffect(() => {
        if (initialized.current) return
        initialized.current = true

        let mathfield: any = null

        const init = async () => {
            try {
                const mathlive = await import('mathlive')

                // Point MathLive to locally bundled fonts
                const MFE = (mathlive as any).MathfieldElement ?? (window as any).MathfieldElement
                if (MFE) {
                    MFE.fontsDirectory = '/fonts/mathlive/'
                }

                if (!containerRef.current) return

                // Create the math-field element
                const mf = document.createElement('math-field') as any
                mf.className = 'latex-editor-mathfield'
                mf.setAttribute('smart-mode', 'true')
                mf.setAttribute('smart-fence', 'true')
                mf.setAttribute('smart-superscript', 'true')
                mf.setAttribute('math-virtual-keyboard-policy', 'manual')

                containerRef.current.appendChild(mf)
                mathfield = mf
                mathfieldRef.current = mf

                // Virtual keyboard is controlled by the keyboardVisible prop
                const kbd = (window as any).mathVirtualKeyboard
                if (kbd) {
                    kbd.container = document.body
                }

                // Set initial value if provided
                if (value) {
                    mf.setValue(value)
                }

                // Listen for input changes
                mf.addEventListener('input', () => {
                    const newLatex = mf.getValue('latex')
                    onChange(newLatex)
                })

            } catch (err) {
                console.warn('[latex-editor] MathLive failed to load, using textarea fallback:', err)
                fallback.current = true
                renderFallback()
            }
        }

        const renderFallback = () => {
            if (!containerRef.current) return
            containerRef.current.innerHTML = ''
            const ta = document.createElement('textarea')
            ta.className = 'latex-editor-textarea'
            ta.placeholder = 'Enter your LaTeX equation here…'
            ta.setAttribute('aria-label', 'LaTeX equation input')
            ta.value = value
            ta.addEventListener('input', () => {
                onChange(ta.value)
            })
            containerRef.current.appendChild(ta)
            mathfieldRef.current = {
                getValue: () => ta.value,
                setValue: (v: string) => {
                    ta.value = v
                    onChange(v)
                },
                focus: () => ta.focus(),
                executeCommand: (cmd: string | string[]) => {
                    // Handle both ['insert', text] and plain text
                    const text = Array.isArray(cmd) ? cmd[1] : cmd
                    if (!text) return
                    const start = ta.selectionStart
                    const end = ta.selectionEnd
                    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end)
                    ta.selectionStart = ta.selectionEnd = start + text.length
                    onChange(ta.value)
                },
            }
        }

        init()

        return () => {
            // Hide keyboard and reset container when component unmounts
            const kbd = (window as any).mathVirtualKeyboard
            if (kbd) {
                kbd.hide()
                kbd.container = document.body
            }
            if (mathfield && mathfield.remove) {
                mathfield.remove()
            }
        }
        // Only run once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Sync external value changes into MathLive
    useEffect(() => {
        if (!mathfieldRef.current) return
        if (fallback.current) return
        const currentValue = mathfieldRef.current.getValue?.('latex') ?? ''
        if (currentValue !== value) {
            mathfieldRef.current.setValue(value)
        }
    }, [value, mathfieldRef])

    // Toggle virtual keyboard based on prop
    useEffect(() => {
        const kbd = (window as any).mathVirtualKeyboard
        if (!kbd) return
        if (keyboardVisible) {
            kbd.show({ animate: true })
        } else {
            kbd.hide({ animate: true })
        }
    }, [keyboardVisible])

    return (
        <div className="latex-editor-mathfield-wrapper" ref={containerRef} />
    )
}

export default MathLiveInput
