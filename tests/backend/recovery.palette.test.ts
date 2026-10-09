import { describe,expect,it,vi } from 'vitest'
import { freezeOriginalPalette } from '../../backend/src/temporal/activities/turn-palettes.js'

describe('original-turn permission ceiling [F:backend.activity.turn_palettes.freezeOriginalPalette]',() => {
  it('hides and refuses newly available tools while preserving cached operation authority and identities',async () => {
    const call=vi.fn(async () => ({ content: 'TEST confirmed original result' }))
    const original={ authorityId: 'TEST original transport authority',listTools: async () => [{ name: 'old.read',description: 'original allowed read',parameters: { type: 'object' as const } },{ name: 'new.mutate',description: 'new capability',parameters: { type: 'object' as const } }],callTool: call }
    const frozen=freezeOriginalPalette(original,['old.read'])
    expect(frozen.authorityId).toBe(original.authorityId)
    expect((await frozen.listTools()).map((tool) => tool.name)).toEqual(['old.read'])
    expect(await frozen.callTool('new.mutate',{},'TEST new effect')).toMatchObject({ isError: true })
    expect(call).not.toHaveBeenCalled()
    expect(await frozen.callTool('old.read',{ exact: 'original args' },'TEST original operation')).toEqual({ content: 'TEST confirmed original result' })
    expect(call).toHaveBeenCalledWith('old.read',{ exact: 'original args' },'TEST original operation')
  })
})
