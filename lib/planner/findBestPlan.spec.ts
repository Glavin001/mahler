import { expect, log } from '~/test-utils';
import { Planner } from '.';
import { Task } from '../task';
import { plan, stringify } from '../testing';

describe('Planner.findBestPlan', () => {
	it('chooses the plan with lower estimated cost', () => {
		type State = { n: number };

		const inc = Task.of<State>().from({
			lens: '/n',
			condition: (n, { target }) => n < target,
			effect: (n) => {
				n._ = n._ + 1;
			},
			description: 'inc',
			estimate: 1,
		});

		const incFast = Task.of<State>().from({
			lens: '/n',
			condition: (n, { target }) => n < target,
			effect: (n) => {
				n._ = n._ + 2;
			},
			description: 'inc-fast',
			estimate: 3,
		});

		const planner = Planner.from<State>({
			tasks: [incFast, inc],
			config: { trace: log },
		});

		const result = planner.findBestPlan({ n: 0 }, { n: 2 });
		expect(result.success).to.be.true;
		expect(stringify(result)).to.equal(
			plan().action('inc').action('inc').end(),
		);
	});
});
