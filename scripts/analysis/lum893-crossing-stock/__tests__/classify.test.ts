import { classifyCrossingDetail } from '../classify'

describe('LUM-893 crossing stock classify', () => {
  it('maps a stored detail back to its rule and the LUM-893 verdict', () => {
    expect(
      classifyCrossingDetail(
        'Credential in an environment assignment in docker-compose.yml'
      )
    ).toEqual({
      ruleId: 'env-assignment',
      file: 'docker-compose.yml',
      lum887: true,
      advisoryNow: true,
    })
    expect(
      classifyCrossingDetail('OpenAI API key in /repo/.env.local')
    ).toEqual({
      ruleId: 'openai-key',
      file: '/repo/.env.local',
      lum887: false,
      advisoryNow: true,
    })
    expect(
      classifyCrossingDetail('GitLab personal access token in scripts/push.sh')
    ).toMatchObject({ ruleId: 'gitlab-pat', lum887: true, advisoryNow: false })
    expect(classifyCrossingDetail('something else')).toMatchObject({
      ruleId: null,
    })
  })
})
