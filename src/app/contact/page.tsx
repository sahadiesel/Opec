import type { Metadata } from 'next';
import { CompanySiteShell } from '@/components/company-site/site-shell';
import { CLIENTS, COMPANY } from '@/components/company-site/content';

const MAPS_LINK = 'https://maps.app.goo.gl/m7gQSfW6bdnczJbD7';
/** Official embed for บจก. ออฟชอร์ พาวเวอร์ เอ็นจิเนียริ่ง (place 7.1847427, 100.5971848). */
const MAP_EMBED =
  'https://www.google.com/maps/embed?pb=!1m4!3m2!1m1!4s12338726645619676303!6i17!3m1!1sth!5m1!1sth';

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

        <div className="flex min-h-[460px] flex-col border border-[#d7e0ea] bg-white lg:min-h-full">
          <iframe
            title="แผนที่สำนักงาน OPEC"
            src={MAP_EMBED}
            className="min-h-[380px] w-full flex-1 border-0"
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
          <a
            href={MAPS_LINK}
            target="_blank"
            rel="noreferrer"
            className="block border-t border-[#d7e0ea] px-4 py-3 text-center text-sm font-semibold text-[#e36f1e] hover:underline"
          >
            คลิกเพื่อเปิดใน google map
          </a>
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
