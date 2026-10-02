import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Body, Caption, CardTitle, Eyebrow, Mono, PageTitle, SectionTitle } from '@/components/text'

describe('text primitives', () => {
  it('renders the page title as the level-one heading', () => {
    render(<PageTitle>Overview</PageTitle>)
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('renders section and card titles at their levels', () => {
    render (
      <>
        <SectionTitle>Sector researches</SectionTitle>
        <CardTitle>Approved work</CardTitle>
      </>
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Sector researches' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Approved work' })).toBeInTheDocument()
  })

  it('renders eyebrow, body, caption, and mono copy as readable text', () => {
    render (
      <>
        <Eyebrow>Research status</Eyebrow>
        <Body>Research is in progress.</Body>
        <Caption>Showing 50 of 100 work items</Caption>
        <Mono>v2</Mono>
      </>
    )
    expect(screen.getByText('Research status')).toBeInTheDocument()
    expect(screen.getByText('Research is in progress.')).toBeInTheDocument()
    expect(screen.getByText('Showing 50 of 100 work items')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
  })
})
