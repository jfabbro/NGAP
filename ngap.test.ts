import { ngap, actType, type Act, type PatientContext } from "./ngap.ts";

const autonome: PatientContext = { dependant: false, enfantMoinsDe5Ans: false };
const dependant: PatientContext = { dependant: true, enfantMoinsDe5Ans: false };

// Cas 1 : séance combinée — prélèvement veineux (coeff 1.5) + vaccination (coeff 2.4), patient autonome
// Attendu : vaccination 100% (plus cher), prélèvement 50%
const actes1: Act[] = [
    {
        id: "PREL-001",
        name: "Prélèvement par ponction veineuse directe",
        keywords: ["prise de sang", "PVD", "bilan sanguin"],
        act: actType.AMI,
        coefficient: 1.5,
    },
    {
        id: "INJ-011",
        name: "Vaccination avec prescription médicale",
        keywords: ["vaccin", "vaccination", "IM"],
        act: actType.AMI,
        coefficient: 2.4,
    },
];

// Cas 2 : pansements lourds — bilan initial (coeff 11) + escarre (coeff 4) + analgésie (coeff 1.1), patient autonome
// Attendu : bilan 100%, escarre 50%, analgésie 0%
const actes2: Act[] = [
    {
        id: "PLC-001",
        name: "Bilan initial pansement lourd et complexe",
        keywords: ["bilan", "première prise en charge", "plaie chronique"],
        act: actType.AMI,
        coefficient: 11,
    },
    {
        id: "PLC-009",
        name: "Pansement d'escarre profonde atteignant muscles ou tendons",
        keywords: ["escarre", "pansement lourd", "profonde"],
        act: actType.AMI,
        coefficient: 4,
    },
    {
        id: "PLC-012",
        name: "Analgésie topique préalable à un pansement d'ulcère",
        keywords: ["analgésie", "topique", "ulcère"],
        act: actType.AMI,
        coefficient: 1.1,
    },
];

// Cas 3 : soins diabétiques — injection SC (coeff 1) + forfait BSI partiel (coeff 3), patient dépendant
// Attendu : AMI → AMX, tous à 50%
const actes3: Act[] = [
    {
        id: "INJ-006",
        name: "Injection sous-cutanée",
        keywords: ["insuline", "SC", "injection sous-cutanée"],
        act: actType.AMI,
        coefficient: 1,
    },
    {
        id: "BSI-002",
        name: "Forfait BSI dépendance partielle",
        keywords: ["BSI", "dépendance", "nursing", "BSB"],
        act: actType.BSA,
        coefficient: 3,
    },
];

console.log("--- Cas 1 : prélèvement + vaccination (autonome) ---");
console.log(ngap(actes1, autonome));

console.log("--- Cas 2 : pansements lourds complexes (autonome) ---");
console.log(ngap(actes2, autonome));

console.log("--- Cas 3 : soins diabétiques + BSI (dépendant) ---");
console.log(ngap(actes3, dependant));
