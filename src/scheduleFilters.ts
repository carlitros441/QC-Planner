import type { Filters, Schedule } from './types';

export function filterSchedules(schedules: Schedule[], filters: Filters) {
  return schedules.filter(schedule =>
    (!filters.status.length || filters.status.includes(schedule.status)) &&
    (!filters.assignee.length || filters.assignee.some(id => [schedule.assignee_id, schedule.trainee_id, schedule.trainee_2_id].includes(id))) &&
    (!filters.protocol.length || filters.protocol.includes(schedule.protocol_name)) &&
    (!filters.product.length || filters.product.includes(schedule.product_name || schedule.product_id)) &&
    (!filters.batch.length || filters.batch.includes(schedule.batch_number)) &&
    (!filters.test.length || filters.test.includes(schedule.test_name))
  );
}
