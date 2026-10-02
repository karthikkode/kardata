import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Body, BodySm, Caption, CardTitle, Description, Display, Kbd, Label, Mono,
  Numeric, Overline, PageDescription, PageTitle, SectionTitle, WorkspaceTitle,
} from '@/components/text'

describe('text primitives', () => {
  it('renders the page title as the level-one heading', () => {
    render(<PageTitle>Overview</PageTitle>)
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('renders the display title as a level-one heading', () => {
    render(<Display>Reserved</Display>)
    expect(screen.getByRole('heading', { level: 1, name: 'Reserved' })).toBeInTheDocument()
  })

  it('renders section, workspace, and card titles at their levels', () => {
    render (
      <>
        <SectionTitle>Sector researches</SectionTitle>
        <WorkspaceTitle>Research</WorkspaceTitle>
        <CardTitle>Approved work</CardTitle>
      </>
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Sector researches' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Research' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Approved work' })).toBeInTheDocument()
  })

  it('renders overline, body, caption, and mono copy as readable text', () => {
    render (
      <>
        <Overline>Research status</Overline>
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

  it('renders the dense and secondary copy primitives', () => {
    render (
      <>
        <PageDescription>Research activity across all sectors.</PageDescription>
        <BodySm>Sector name</BodySm>
        <Description>Card subtitle</Description>
        <Label>Session</Label>
      </>
    )
    expect(screen.getByText('Research activity across all sectors.')).toBeInTheDocument()
    expect(screen.getByText('Sector name')).toBeInTheDocument()
    expect(screen.getByText('Card subtitle')).toBeInTheDocument()
    expect(screen.getByText('Session')).toBeInTheDocument()
  })

  it('renders numbers tabular and shortcuts as keyboard chips', () => {
    render (
      <>
        <Numeric>1,240</Numeric>
        <Numeric size="stat">32</Numeric>
        <Kbd>Ctrl K</Kbd>
      </>
    )
    expect(screen.getByText('1,240')).toHaveClass('tabular-nums')
    expect(screen.getByText('32')).toHaveClass('tabular-nums')
    expect(screen.getByText('Ctrl K').tagName).toBe('KBD')
  })

  it('tags every primitive with its data-type for audits', () => {
    const { container } = render (
      <>
        <Display>d</Display>
        <PageTitle>t</PageTitle>
        <PageDescription>pd</PageDescription>
        <WorkspaceTitle>w</WorkspaceTitle>
        <SectionTitle>s</SectionTitle>
        <CardTitle>c</CardTitle>
        <Body>b</Body>
        <BodySm>bs</BodySm>
        <Description>de</Description>
        <Caption>ca</Caption>
        <Label>la</Label>
        <Overline>ov</Overline>
        <Numeric>n</Numeric>
        <Mono>m</Mono>
        <Kbd>k</Kbd>
      </>
    )
    for (const name of ['Display', 'PageTitle', 'PageDescription', 'WorkspaceTitle', 'SectionTitle', 'CardTitle', 'Body', 'BodySm', 'Description', 'Caption', 'Label', 'Overline', 'Numeric', 'Mono', 'Kbd']) {
      expect(container.querySelector(`[data-type="${name}"]`), name).not.toBeNull()
    }
  })
})
