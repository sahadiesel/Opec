import type { Metadata } from 'next';
import Link from 'next/link';
import { CompanySiteShell } from '@/components/company-site/site-shell';
import { CHAIN, COMPANY, PILLARS } from '@/components/company-site/content';

const LOGIN_BG_URL = 'https://firebasestorage.googleapis.com/v0/b/opec-data-sg/o/OPEC_Image_2.png?alt=media';

export const metadata: Metadata = {
  title: 'OPEC | Offshore Manpower & Marine Supply',
  description: COMPANY.tagline,
};

export default function CompanyHomePage() {
  return (
    <CompanySiteShell>
      <section className="relative h-[min(70vh,640px)] min-h-[380px] bg-[#071426]">
        <img
          src={LOGIN_BG_URL}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      </section>

      <section className="border-b border-[#d7e0ea] bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-y divide-[#e6edf4] md:grid-cols-4 md:divide-y-0">
          {[
            ['2014', 'Established in Songkhla'],
            ['5', 'Integrated service pillars'],
            ['Offshore', 'Workforce and field support'],
            ['Gulf of Thailand', 'Primary operating environment'],
          ].map(([value, label]) => (
            <div key={label} className="px-5 py-6">
              <p className="text-xl font-black text-[#0b1c33]">{value}</p>
              <p className="mt-1 text-sm text-[#5c6b7a]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">About OPEC</p>
          <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">
            One coordinated platform for people, engineering, equipment and marine logistics
          </h2>
          <div className="mt-5 space-y-4 text-sm leading-relaxed text-[#3d4d5e]">
            <p>
              Offshore Power Engineering Corporation Co., Ltd. (OPEC) was established on {COMPANY.established} by a
              group of engineers with experience in design engineering, Front-End Engineering Design (FEED),
              construction and project support for the oil and gas, refinery, LNG, petrochemical, power generation,
              pipeline and offshore industries.
            </p>
            <p>
              Today, manpower supply is OPEC&apos;s core business. From a local base in Southern Thailand and the Gulf
              of Thailand, the company coordinates offshore equipment, materials, marine logistics, diesel fuel and
              engineering and construction services.
            </p>
            <p>
              OPEC&apos;s purpose is to reduce operational complexity for clients by coordinating the resources required
              to mobilize, execute and support offshore work safely and efficiently.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <img
            src="/company/crew.jpg"
            alt="OPEC crew at a crew-change check-in"
            className="h-64 w-full rounded-lg object-cover sm:col-span-2 sm:h-72"
          />
          <img
            src="/company/office.jpg"
            alt="OPEC team in company coveralls"
            className="h-48 w-full rounded-lg object-cover"
          />
          <img
            src="/company/facility-hero.jpg"
            alt="Walkway alongside an offshore process platform"
            className="h-48 w-full rounded-lg object-cover"
          />
        </div>
      </section>

      <section className="bg-[#0b1c33] py-16 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Local capability. Integrated delivery.</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-black">Practical support designed around client schedules and site conditions</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CHAIN.map((item) => (
              <div key={item.title} className="border border-white/10 bg-white/5 p-5">
                <p className="text-lg font-black">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Core services</p>
            <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">One partner across the offshore support chain</h2>
          </div>
          <Link href="/services" className="text-sm font-bold text-[#e36f1e] hover:underline">
            All services
          </Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PILLARS.map((pillar, i) => (
            <Link
              key={pillar.key}
              href={`/services#${pillar.key}`}
              className="group border border-[#d7e0ea] bg-white p-5 hover:border-[#e36f1e]"
            >
              <p className="text-xs font-bold tracking-[0.16em] text-[#e36f1e]">0{i + 1}</p>
              <h3 className="mt-2 text-lg font-black text-[#0b1c33] group-hover:text-[#e36f1e]">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{pillar.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-[#071426] px-5 py-14 text-white sm:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">From shore base to offshore site</p>
          <h2 className="mt-2 max-w-xl text-3xl font-black">Coordinated resources for continuous operations</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75">
            OPEC supports the movement of people, materials and fuel required to maintain offshore project schedules.
          </p>
          <Link href="/products" className="mt-5 inline-block text-sm font-bold text-[#e36f1e] hover:underline">
            See products and logistics
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Ready to support your next offshore project</p>
        <h2 className="mt-3 text-3xl font-black text-[#0b1c33]">Qualified people. Practical resources. Responsive local coordination.</h2>
        <Link href="/contact" className="mt-8 inline-block rounded-md bg-[#0b1c33] px-5 py-3 text-sm font-bold text-white hover:bg-[#e36f1e]">
          Contact Us
        </Link>
      </section>
    </CompanySiteShell>
  );
}
