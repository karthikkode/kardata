// Ban fixture: UI-only code (must pass pilot lint).
interface PilotPage {
  goto(url: string): Promise<unknown>
  getByRole(role: string): { click(): Promise<void> }
}
export async function cleanUiOnly(page: PilotPage): Promise<void> {
  await page.goto('/?section=Researches')
  await page.getByRole('button').click()
}
