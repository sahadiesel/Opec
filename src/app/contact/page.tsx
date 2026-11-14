import type { Metadata } from 'next';
import { CompanySiteShell } from '@/components/company-site/site-shell';
import { CLIENTS, COMPANY, LEADERS } from '@/components/company-site/content';

export const metadata: Metadata = {
  title: 'Contact Us | OPEC',
  description: 'Contact Offshore Power Engineering Corporation in Songkhla, Thailand.',
};

export default function ContactPage() {
  return (
    <CompanySiteShell>
      <section className="bg-[#071426] px-4 py-16 text-white sm:px-6">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Contact Us</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-black leading-tight">
            Qualified people. Practical resources. Responsive local coordination.
          </h1>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-[#0b1c33] p-6 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">Company</p>
          <h2 className="mt-2 text-xl font-black">{COMPANY.legalName}</h2>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">Address</p>
          <p className="mt-2 text-sm leading-relaxed text-white/80">
            {COMPANY.address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">Telephone</p>
          <div className="mt-2 space-y-1 text-sm">
            {COMPANY.phones.map((phone) => (
              <a key={phone} href={`tel:${phone.replace(/\s/g, '')}`} className="block text-white hover:text-[#e36f1e]">
                {phone}
              </a>
            ))}
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">Email</p>
          <a href={`mailto:${COMPANY.email}`} className="mt-2 block text-sm text-white hover:text-[#e36f1e]">
            {COMPANY.email}
          </a>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Leadership</p>
          <h2 className="mt-2 text-2xl font-black text-[#0b1c33]">Management team</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {LEADERS.map((person) => (
              <article key={person.email} className="border border-[#d7e0ea] bg-white">
                <img src={person.image} alt={person.name} className="aspect-square w-full object-cover" />
                <div className="p-4">
                  <h3 className="text-sm font-black text-[#0b1c33]">{person.name}</h3>
                  <p className="mt-1 text-xs text-[#5c6b7a]">{person.role}</p>
                  <a href={`mailto:${person.email}`} className="mt-2 block text-xs font-semibold text-[#e36f1e] hover:underline">
                    {person.email}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#d7e0ea] bg-white py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Selected clients & industry organizations</p>
          <div className="mt-6 grid grid-cols-2 items-center gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {CLIENTS.map((client) => (
              <div key={client.name} className="flex h-24 items-center justify-center border border-[#e6edf4] bg-white p-3">
                <img src={client.image} alt={client.name} className="max-h-16 w-full object-contain" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </CompanySiteShell>
  );
}
