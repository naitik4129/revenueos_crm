import { SearchPicker, type PickerOption } from "@/components/common/search-picker";
import { backend } from "@/lib/backend-client";

export function CompanyPicker(props: {
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
}) {
  return (
    <SearchPicker
      kind="company-picker"
      placeholder="No company"
      search={async (search, signal) =>
        (await backend.companies.list({ search: search || undefined, limit: 20 }, signal)).data.map(
          (company) => ({ id: company.id, label: company.name, hint: company.domain }),
        )
      }
      {...props}
    />
  );
}

export function ContactPicker(props: {
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  excludeId?: string;
}) {
  return (
    <SearchPicker
      kind="contact-picker"
      placeholder="Choose a contact"
      search={async (search, signal) =>
        (await backend.contacts.list({ search: search || undefined, limit: 20 }, signal)).data.map(
          (contact) => ({
            id: contact.id,
            label: `${contact.firstName} ${contact.lastName}`.trim(),
            hint: contact.email ?? contact.companyName,
          }),
        )
      }
      {...props}
    />
  );
}

/** Open deals, searched by contact or company. */
export function DealPicker(props: {
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
}) {
  return (
    <SearchPicker
      kind="deal-picker"
      placeholder="Choose a deal"
      search={async (search, signal) =>
        (
          await backend.deals.list(
            { search: search || undefined, outcome: "open", limit: 20 },
            signal,
          )
        ).data.map((deal) => ({ id: deal.id, label: deal.contactName, hint: deal.companyName }))
      }
      {...props}
    />
  );
}
