import type { Metadata } from 'next';
import Link from 'next/link';
import { CompanySiteShell } from '@/components/company-site/site-shell';
import {
  ASSIGNMENTS,
  DESIGN_SCOPE,
  ENGINEERING,
  FACILITIES,
  POSITIONS,
  SERVICES,
  WORKFORCE_STEPS,
} from '@/components/company-site/content';

export const metadata: Metadata = {
  title: 'Services | OPEC',
  description: 'Manpower supply, marine logistics, fuel, equipment and engineering services from OPEC.',
};

export default function ServicesPage() {
  return (
    <CompanySiteShell>
      <section className="bg-[#071426] px-4 py-16 text-white sm:px-6">
        <div className="mx-auto grid max-w-6xl items-end gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Core services</p>
            <h1 className="mt-3 text-4xl font-black leading-tight">One partner across the offshore support chain</h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70">
              OPEC combines workforce capability with engineering, procurement, equipment, marine and fuel-support
              services. Clients can coordinate people, field supplies, vessels, fuel and technical execution through
              one local partner.
            </p>
          </div>
          <img
            src="/company/crew.jpg"
            alt="OPEC personnel prepared for mobilization"
            className="h-56 w-full rounded-lg object-cover lg:h-64"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-6 px-4 py-14 sm:px-6">
        {SERVICES.map((service) => (
          <article key={service.id} id={service.id} className="scroll-mt-24 border border-[#d7e0ea] bg-white p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">
              {service.index} · {service.kicker}
            </p>
            <h2 className="mt-2 text-2xl font-black text-[#0b1c33]">{service.title}</h2>
            {'text' in service ? (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#3d4d5e]">{service.text}</p>
            ) : (
              <ul className="mt-4 grid gap-2 text-sm text-[#3d4d5e] sm:grid-cols-2">
                {service.points.map((point) => (
                  <li key={point} className="border-l-2 border-[#e36f1e] pl-3">
                    {point}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <section className="bg-white py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Manpower supply</p>
          <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">Ready people for demanding offshore operations</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#5c6b7a]">
            Recruitment, workforce and crewing for oil and gas, marine, process, construction and related industries —
            from talent sourcing through mobilization, field support, insurance administration and demobilization.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {WORKFORCE_STEPS.map((step) => (
              <div key={step.n} className="bg-[#f4f7fb] p-5">
                <p className="text-2xl font-black text-[#e36f1e]">{step.n}</p>
                <h3 className="mt-2 font-black text-[#0b1c33]">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{step.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="border border-[#d7e0ea] p-5">
              <h3 className="font-black text-[#0b1c33]">Personal protective equipment</h3>
              <p className="mt-2 text-sm text-[#5c6b7a]">Provision and coordination of appropriate PPE for assigned personnel.</p>
            </div>
            <div className="border border-[#d7e0ea] p-5">
              <h3 className="font-black text-[#0b1c33]">Local logistics & insurance</h3>
              <p className="mt-2 text-sm text-[#5c6b7a]">Field logistics support and workforce insurance administration.</p>
            </div>
            <div className="border border-[#d7e0ea] p-5">
              <h3 className="font-black text-[#0b1c33]">Mobilization / demobilization</h3>
              <p className="mt-2 text-sm text-[#5c6b7a]">Personnel prepared for travel, movement coordination and site access.</p>
            </div>
          </div>
          <h3 className="mt-10 text-lg font-black text-[#0b1c33]">Specialized positions</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {POSITIONS.map((role) => (
              <span key={role} className="rounded-full border border-[#d7e0ea] bg-white px-3 py-1 text-xs font-semibold text-[#1c2b3a]">
                {role}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <img
            src="/company/engineering.jpg"
            alt="Offshore structural and welding work"
            className="h-72 w-full rounded-lg object-cover"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Technical delivery</p>
            <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">Engineering, fabrication, construction and plant services</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#5c6b7a]">
              Support ranges from secondment of key personnel and conceptual studies to minor site modifications and
              detailed design. Teams are scaled to match workload and schedule.
            </p>
          </div>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ENGINEERING.map((item) => (
            <div key={item.title} className="border border-[#d7e0ea] bg-white p-5">
              <h3 className="font-black text-[#0b1c33]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{item.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 bg-[#0b1c33] p-6 text-white sm:p-8">
          <h3 className="text-xl font-black">Design services from concept to detailed engineering</h3>
          <p className="mt-2 max-w-3xl text-sm text-white/70">
            A complete design package, a focused engineering study, or specialist support on a man-hour basis —
            subject to resource availability and project requirements.
          </p>
          <ul className="mt-5 grid gap-2 text-sm text-white/85 sm:grid-cols-2">
            {DESIGN_SCOPE.map((item) => (
              <li key={item} className="border-l-2 border-[#e36f1e] pl-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-white py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Industry experience</p>
          <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">Offshore facilities and construction environments</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {FACILITIES.map((site) => (
              <article key={site.title} className="overflow-hidden border border-[#d7e0ea]">
                <img src={site.image} alt="" className="h-44 w-full object-cover" />
                <div className="p-5">
                  <h3 className="font-black text-[#0b1c33]">{site.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{site.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e36f1e]">Recent assignments</p>
        <h2 className="mt-2 text-3xl font-black text-[#0b1c33]">Selected manpower supply experience, 2022–2026</h2>
        <p className="mt-3 max-w-3xl text-sm text-[#5c6b7a]">
          OPEC&apos;s senior management team has more than eight years of oil and gas business experience.
        </p>
        <div className="mt-8 space-y-4">
          {ASSIGNMENTS.map((job) => (
            <article key={job.client} className="grid gap-2 border border-[#d7e0ea] bg-white p-5 sm:grid-cols-[7rem_1fr]">
              <p className="text-sm font-black text-[#e36f1e]">{job.years}</p>
              <div>
                <h3 className="font-black text-[#0b1c33]">{job.client}</h3>
                <p className="mt-1 text-sm text-[#3d4d5e]">{job.place}</p>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b7a]">{job.roles}</p>
              </div>
            </article>
          ))}
        </div>
        <Link href="/contact" className="mt-8 inline-block text-sm font-bold text-[#e36f1e] hover:underline">
          Talk to the team
        </Link>
      </section>
    </CompanySiteShell>
  );
}
