import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterCheckboxGroup } from '@/lib/editor/nodes/task-view-filter-group'

it('toggles a value on and off via onChange', async () => {
  const onChange = jest.fn()
  const { rerender } = render(
    <FilterCheckboxGroup
      title='Status'
      options={[
        { value: 'TODO', label: 'Todo' },
        { value: 'DONE', label: 'Done' },
      ]}
      selected={[]}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('checkbox', { name: 'Done' }))
  expect(onChange).toHaveBeenCalledWith(['DONE'])

  rerender(
    <FilterCheckboxGroup
      title='Status'
      options={[
        { value: 'TODO', label: 'Todo' },
        { value: 'DONE', label: 'Done' },
      ]}
      selected={['DONE']}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('checkbox', { name: 'Done' }))
  expect(onChange).toHaveBeenLastCalledWith([])
})
