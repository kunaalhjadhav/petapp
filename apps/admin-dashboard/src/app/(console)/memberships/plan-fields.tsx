import { Field, Input } from '@/components/ui';
import type { MembershipPlan } from '@/lib/types';

const check = 'flex items-center gap-2 text-sm';

/** The fields of a plan, for adding one or editing one. */
export function PlanFields({ plan }: { plan?: MembershipPlan }) {
  const p = plan?.id ?? 'new';
  const free = plan?.key === 'FREE';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {!plan && (
        <Field
          label="Key"
          htmlFor={`${p}-key`}
          hint="Capitals, like PLUS_YEAR. Can’t be changed later."
        >
          <Input id={`${p}-key`} name="key" required pattern="[A-Za-z][A-Za-z0-9_]{1,29}" />
        </Field>
      )}
      <Field label="Name" htmlFor={`${p}-name`}>
        <Input
          id={`${p}-name`}
          name="name"
          required
          minLength={2}
          maxLength={40}
          defaultValue={plan?.name}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description" htmlFor={`${p}-description`}>
          <Input
            id={`${p}-description`}
            name="description"
            maxLength={300}
            defaultValue={plan?.description}
          />
        </Field>
      </div>
      <Field
        label="Price (₹)"
        htmlFor={`${p}-price`}
        hint={free ? 'The Free plan stays free.' : 'Including GST'}
      >
        <Input
          id={`${p}-price`}
          name="price"
          inputMode="decimal"
          required
          defaultValue={plan ? String(plan.pricePaise / 100) : ''}
          readOnly={free}
        />
      </Field>
      <Field label="Length (days)" htmlFor={`${p}-period`}>
        <Input
          id={`${p}-period`}
          name="periodDays"
          type="number"
          min={1}
          max={366}
          required
          defaultValue={plan?.periodDays ?? 30}
        />
      </Field>
      <Field label="Order" htmlFor={`${p}-rank`} hint="Plans are listed from low to high">
        <Input
          id={`${p}-rank`}
          name="rank"
          type="number"
          min={0}
          max={1000}
          defaultValue={plan?.rank ?? 10}
        />
      </Field>
      <Field label="Priority booking (extra days ahead)" htmlFor={`${p}-priority`} hint="0 = none">
        <Input
          id={`${p}-priority`}
          name="priorityDays"
          type="number"
          min={0}
          max={180}
          defaultValue={plan?.benefits.priorityDays ?? 0}
        />
      </Field>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-medium">Benefits</legend>
        <label className={check}>
          <input
            type="checkbox"
            name="exclusiveContests"
            defaultChecked={plan?.benefits.exclusiveContests}
          />{' '}
          Members-only contests
        </label>
        <label className={check}>
          <input
            type="checkbox"
            name="premiumChallenges"
            defaultChecked={plan?.benefits.premiumChallenges}
          />{' '}
          Premium challenges
        </label>
        <label className={check}>
          <input
            type="checkbox"
            name="memberDiscounts"
            defaultChecked={plan?.benefits.memberDiscounts}
          />{' '}
          Member coupons in the shop
        </label>
        <label className={check}>
          <input type="checkbox" name="badge" defaultChecked={plan?.benefits.badge} /> Member badge
          on the profile
        </label>
        <label className={check}>
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={plan ? plan.isActive : true}
            disabled={free}
          />{' '}
          Can be bought {free && '(always available)'}
        </label>
        {free && <input type="hidden" name="isActive" value="true" />}
      </fieldset>
    </div>
  );
}
