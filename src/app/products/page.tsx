import type { Metadata } from 'next';
import Link from 'next/link';
import { CompanySiteShell } from '@/components/company-site/site-shell';
import { PRODUCTS } from '@/components/company-site/content';

export const metadata: Metadata = {
  title: 'Products | OPEC',
  description: 'Offshore equipment, lifting gear, consumables, blasting systems, marine logistics and diesel fuel coordination.',
};

export default function ProductsPage() {
  return (
    <CompanySiteShell>
      <section className="bg-[#071426] text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Equipment, marine logistics & fuel</p>
            <h1 className="mt-3 text-4xl font-black leading-tight">Practical supply support from shore base to offshore site</h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              OPEC coordinates commonly required offshore equipment, tools and consumables with attention to
              availability, applicable certification and safe field use. Delivery plans can be aligned with
              mobilization schedules, marine availability and offshore receiving windows.
            </p>
          </div>
          <img src="/company/crew-boat.jpg" alt="Crew boat used for personnel transfer" className="h-64 w-full rounded-lg object-cover" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['Supply', 'Procurement and delivery of equipment, consumables, fasteners and certified lifting accessories.'],
            ['Rental', 'Short- or project-term rental coordination for welding machines, generators and air compressors.'],
            ['Lifting & rigging', 'Wire-rope slings, chain slings, hooks, master links, turnbuckles, lifting beams and related accessories, sourced to project requirements.'],
          ].map(([title, text]) => (
            <div key={title} className="border border-[#d7e0ea] bg-white p-5">
              <h2 className="font-black text-[#0b1c33]">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{text}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-3xl font-black text-[#0b1c33]">Representative supply and rental items</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((item) => (
            <article key={item.title} className="overflow-hidden border border-[#d7e0ea] bg-white">
              <img src={item.image} alt={item.title} className="h-40 w-full bg-[#f4f7fb] object-contain" />
              <div className="p-4">
                <h3 className="font-black text-[#0b1c33]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{item.text}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[#5c6b7a]">
          Representative images illustrate product categories. Actual brands, models and stock availability may vary.
          Brands, capacities, material grades and certification requirements are confirmed against the client&apos;s
          technical specification. Lifting gear should be supplied with the inspection and test documentation required
          for its intended use.
        </p>
        <img
          src="/company/marine-deck.jpg"
          alt="Certified chain slings and hooks on a lifting assembly"
          className="mt-8 h-72 w-full rounded-lg object-cover"
        />
      </section>

      <section className="bg-white py-14">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-2">
          <img
            src="/company/blast-hero.jpg"
            alt="Abrasive blasting inside an industrial tank"
            className="h-80 w-full rounded-lg object-cover"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Supply + specialist field services</p>
            <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">Abrasive blasting and protective coating</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#5c6b7a]">
              Blasting equipment, abrasive media, painting systems and field execution for tanks, pressure equipment
              and steel structures, coordinated through a specialist-partner network. Packages can cover equipment
              supply, consumable replenishment, rental, machine maintenance, or complete surface preparation and coating.
            </p>
          </div>
        </div>
        <div className="mx-auto mt-8 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-2">
          <article className="overflow-hidden border border-[#d7e0ea]">
            <img src="/company/tanks.jpg" alt="Tank and vessel blasting and painting" className="h-56 w-full object-cover" />
            <div className="p-5">
              <h3 className="font-black text-[#0b1c33]">Tank & vessel blasting / painting</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">
                Surface cleaning, abrasive blasting, paint removal, preparation and protective-coating application for
                storage tanks, pressure vessels and related equipment.
              </p>
            </div>
          </article>
          <article className="overflow-hidden border border-[#d7e0ea]">
            <img src="/company/structures.jpg" alt="Structural steel preparation and coating" className="h-56 w-full object-cover" />
            <div className="p-5">
              <h3 className="font-black text-[#0b1c33]">Structural steel blasting / painting</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">
                Preparation and coating of fabricated steel, platforms, frames, walkways, pipe supports and industrial
                structures, including site or workshop execution.
              </p>
            </div>
          </article>
        </div>
        <div className="mx-auto mt-4 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-3">
          {[
            ['Blasting equipment & parts', 'Blast pots, control valves, remote-control handles, nozzles, hoses, cabinets, closed-circuit blasters, pipe-blasting tools, metering valves, recycling systems and replacement parts.'],
            ['Abrasive media & air systems', 'Steel shot and grit, stainless cut wire, glass beads, aluminium oxide, garnet, silicon carbide, ceramic or plastic media, plus compressed-air preparation equipment.'],
            ['Painting & maintenance', 'Airless painting systems, spray accessories, coating consumables, inspection coordination, blasting-machine servicing and project-specific equipment selection.'],
          ].map(([title, text]) => (
            <div key={title} className="bg-[#f4f7fb] p-5">
              <h3 className="font-black text-[#0b1c33]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:px-6 md:grid-cols-3">
        {[
          ['Crew boat chartering', 'Personnel transfer services supported by qualified captains and crews.'],
          ['Supply vessel chartering', 'Cargo, materials and structural support for offshore operations.'],
          ['Diesel fuel coordination', 'Industrial diesel supply for onshore delivery and offshore bunkering.'],
        ].map(([title, text]) => (
          <div key={title} className="bg-[#0b1c33] p-6 text-white">
            <h2 className="text-lg font-black">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/70">{text}</p>
          </div>
        ))}
        <div className="md:col-span-3">
          <Link href="/contact" className="text-sm font-bold text-[#e36f1e] hover:underline">
            Request supply or charter coordination
          </Link>
        </div>
      </section>
    </CompanySiteShell>
  );
}
