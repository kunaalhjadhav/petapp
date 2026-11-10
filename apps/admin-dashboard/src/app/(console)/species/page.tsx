import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import type { Breed, Species } from '@/lib/types';
import { Empty, Field, Input, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton, ToggleForm } from '@/components/forms';
import { addBreed, createSpecies, renameBreed, setBreedActive, setSpeciesActive } from './actions';

export const metadata: Metadata = { title: 'Species & breeds' };

export default async function SpeciesPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SPECIES_MANAGE)) return <NoAccess what="species and breeds" />;
  const species = await api<Species[]>('/admin/species');
  const selected = species.find((s) => s.id === sp.s) ?? species[0];
  const breeds = selected ? await api<Breed[]>(`/admin/species/${selected.id}/breeds`) : [];

  return (
    <>
      <PageHeader
        title="Species & breeds"
        description="What owners can choose when they add a pet. Hiding a species or breed removes it from the app’s pickers; pets that already use it keep it."
        actions={
          <ActionDialog
            label="Add species"
            variant="primary"
            title="Add a species"
            action={createSpecies}
            submitLabel="Add species"
          >
            <Field label="Name" htmlFor="sname">
              <Input id="sname" name="name" required maxLength={40} placeholder="Guinea pig" />
            </Field>
            <Field
              label="Key"
              htmlFor="skey"
              hint="Lower-case letters, numbers and dashes. Used in links and filters; it can’t be changed later. Leave empty to derive it from the name."
            >
              <Input
                id="skey"
                name="key"
                maxLength={31}
                pattern="[a-z][a-z0-9-]{1,30}"
                placeholder="guinea-pig"
              />
            </Field>
          </ActionDialog>
        }
      />

      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <Panel title="Species">
          {species.length === 0 ? (
            <Empty title="No species yet">
              Add the first one so owners can create pet profiles.
            </Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {species.map((s) => (
                <li
                  key={s.id}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 ${s.id === selected?.id ? 'bg-teal-wash' : ''}`}
                >
                  <Link
                    href={`/species?s=${s.id}`}
                    aria-current={s.id === selected?.id ? 'true' : undefined}
                    className="min-w-0 flex-1"
                  >
                    <span
                      className={`block text-sm font-medium ${s.isActive ? '' : 'text-muted line-through'}`}
                    >
                      {s.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {s.breedCount} breed{s.breedCount === 1 ? '' : 's'}
                    </span>
                  </Link>
                  <ToggleForm
                    action={setSpeciesActive.bind(null, s.id)}
                    checked={s.isActive}
                    label={`Show ${s.name} in the app`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {selected && (
          <Panel
            title={`${selected.name} breeds`}
            actions={!selected.isActive ? <Tag tone="warn">Species hidden</Tag> : undefined}
          >
            <InlineForm
              action={addBreed.bind(null, selected.id)}
              resetOnSuccess
              className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3"
            >
              <label htmlFor="bname" className="sr-only">
                New breed
              </label>
              <input
                id="bname"
                name="name"
                required
                maxLength={60}
                placeholder="Add a breed"
                className={`${inputClass} max-w-xs`}
              />
              <SubmitButton variant="secondary">Add breed</SubmitButton>
            </InlineForm>
            {breeds.length === 0 ? (
              <Empty title="No breeds yet">
                Owners can still add a {selected.name.toLowerCase()} without choosing a breed.
              </Empty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {breeds.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <InlineForm
                      action={renameBreed.bind(null, b.id)}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <label htmlFor={`b-${b.id}`} className="sr-only">
                        Breed name
                      </label>
                      <input
                        id={`b-${b.id}`}
                        name="name"
                        defaultValue={b.name}
                        maxLength={60}
                        className={`h-8 w-full max-w-xs rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-line focus:border-teal focus:bg-panel focus:outline-none ${b.isActive ? '' : 'text-muted line-through'}`}
                      />
                    </InlineForm>
                    <ToggleForm
                      action={setBreedActive.bind(null, b.id)}
                      checked={b.isActive}
                      label={`Show ${b.name} in the app`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line-soft px-4 py-2 text-xs text-muted">
              Edit a name and press Enter to rename it.
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}
