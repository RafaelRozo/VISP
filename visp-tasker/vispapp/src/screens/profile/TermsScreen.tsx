/**
 * VISP - Terms and Conditions Screen
 * Native scrollable content, bilingual EN/FR.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassBackground } from '../../components/glass';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';

const content = {
  en: {
    title: 'VISP — Terms and Conditions',
    subtitle: 'Verified Independent Service Provider Platform | Effective Date: May 01, 2026 | Version 1.0',
    sections: [
      { heading: '1. Introduction', body: 'Welcome to VISP ("VISP", "we", "us", or "our"). VISP operates a digital marketplace platform (the "Platform") that connects individuals and businesses seeking services ("Clients") with independent service providers ("Service Providers"). VISP is a marketplace and technology service. We are not the employer, agent, contractor, or representative of any Service Provider, and we do not perform any services listed on the Platform.\n\nThese Terms and Conditions ("Terms") govern your access to and use of the VISP mobile application, website, and related services. By creating an account or using the Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you do not agree, do not use the Platform.' },
      { heading: '2. Eligibility', body: '• You must be at least 18 years of age and capable of forming a legally binding contract.\n• You must reside in Canada and be legally permitted to use marketplace services in your province or territory.\n• Service Providers must be legally entitled to perform the services they offer, including holding all required licenses, permits, and certifications where applicable.\n• You agree to provide accurate, current, and complete information during registration and to keep that information up to date.' },
      { heading: '3. Service Provider Tiers and Verification', body: 'VISP uses a tiered verification system to help Clients understand the level of trust and qualification associated with each Service Provider. Tier assignment is determined by VISP at its sole discretion based on the information and documentation provided.\n\nTier 1 — New / Unverified: Newly registered accounts that have not yet completed full verification. Limited access to job categories.\n\nTier 2 — Verified General Services: Service Providers who have completed identity verification and background screening. May offer general, non-regulated services.\n\nTier 3 — Licensed / Regulated Services: Service Providers who have submitted and had verified all licenses, certifications, and permits required to legally perform regulated services.\n\nTier 4 — Restricted (Not Permitted): Covers emergency, high-risk, and otherwise prohibited activities. VISP does not facilitate Tier 4 services.' },
      { heading: '4. Prohibited Services and Conduct', body: 'The following are strictly prohibited on the Platform:\n\n• Any illegal activity or service that violates Canadian federal, provincial, or municipal law.\n• Emergency services, medical treatment, or life-safety services (please contact 911).\n• Sexual services, escort services, or any form of adult-for-hire activity.\n• Services requiring a license or certification that the Service Provider does not hold.\n• Harassment, threats, hate speech, discrimination, or any abusive conduct toward other users or VISP staff.\n• Soliciting Clients or Service Providers to transact outside of the Platform to circumvent fees or oversight.\n• Misrepresenting your identity, qualifications, license status, or insurance coverage.\n• Creating multiple accounts, manipulating ratings, or using bots or automated tools.\n\nVISP reserves the right to suspend or terminate any account, remove listings, or refuse service at our sole discretion if we believe these Terms have been violated.' },
      { heading: '5. VISP\'s Role as a Marketplace', body: 'VISP is a marketplace, not a service provider. VISP does not employ, supervise, or direct Service Providers. Service Providers are independent contractors who set their own availability, methods, and pricing within the limits permitted by the Platform. The contract for any service is formed directly between the Client and the Service Provider.\n\nWhile VISP performs identity verification, background screening, and license checks where applicable, verification is a process of reasonable diligence and is not a guarantee of skill, character, performance, safety, or outcome. Clients are responsible for evaluating Service Providers and the suitability of any service before booking.' },
      { heading: '6. Bookings, Payments, and Fees', body: '• All payments must be processed through the Platform using our payment processor, Stripe. Off-platform payments are prohibited and not protected by these Terms.\n• VISP charges a service fee (commission) on each transaction. The fee structure is disclosed in the Platform and may be updated from time to time with reasonable notice.\n• Service Providers receive payouts via Stripe, subject to Stripe\'s terms, processing times, and verification requirements.\n• Applicable taxes (including GST/HST/PST/QST) are the responsibility of the party legally required to collect and remit them.\n• Refunds, cancellations, and chargebacks are governed by VISP\'s Refund and Cancellation Policy, which forms part of these Terms.' },
      { heading: '7. Reviews, Ratings, and Dispute Resolution', body: 'Clients and Service Providers may rate and review each other after a job is completed. Reviews must be honest, lawful, and free of personal attacks, discriminatory language, or confidential information.\n\nIf a dispute arises regarding a completed or attempted service, both parties are expected to participate in VISP\'s dispute resolution process, which may include:\n\n• Submitting before-and-after photos of the worksite.\n• Engaging in a moderated chat between the Client, the Service Provider, and a VISP representative.\n• Providing receipts, communications, or other relevant evidence requested by VISP.\n\nVISP will review the evidence in good faith and may issue refunds, withhold payouts, or take account-level action. VISP\'s decisions in dispute resolution are final at the platform level but do not waive any legal rights either party may have outside the Platform.' },
      { heading: '8. Limitation of Liability', body: 'To the fullest extent permitted by applicable law, VISP, its affiliates, officers, directors, employees, and agents are not liable for:\n\n• The acts, omissions, conduct, quality of work, or injuries caused by any Service Provider or Client.\n• Damage to property, personal injury, financial loss, or any consequential damages arising from a service booked through the Platform.\n• Disputes between Clients and Service Providers regarding the scope, quality, or timing of services.\n• Misrepresentations made by users in their profiles, listings, or communications.\n• Any loss caused by Platform downtime, technical errors, or third-party service failures (including Stripe).\n\nVerification badges, tier indicators, and reviews are informational only. They are not guarantees of safety, competence, or outcome. Clients use the Platform at their own risk.' },
      { heading: '9. Indemnification', body: 'You agree to indemnify, defend, and hold harmless VISP and its affiliates from any claims, damages, liabilities, losses, costs, or expenses (including reasonable legal fees) arising out of or related to: (a) your use of the Platform; (b) your violation of these Terms; (c) your violation of any law or third-party right; or (d) any service you offer, perform, or receive through the Platform.' },
      { heading: '10. Suspension and Termination', body: 'VISP may suspend or terminate your account at any time, with or without notice, if we reasonably believe you have violated these Terms, posed a safety risk, or engaged in fraud. You may close your account at any time through the Platform. Upon account deletion, your data will be handled in accordance with our Privacy Policy.' },
      { heading: '11. Intellectual Property', body: 'All Platform content, including logos, designs, software, and trademarks, is owned by VISP or its licensors. You receive a limited, non-exclusive, non-transferable license to use the Platform solely as intended. You retain ownership of content you submit (such as photos and reviews) but grant VISP a worldwide, royalty-free license to use, host, display, and distribute that content in connection with operating the Platform.' },
      { heading: '12. Governing Law and Jurisdiction', body: 'These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable therein, without regard to conflict-of-laws principles. The parties submit to the exclusive jurisdiction of the courts located in Ontario for any dispute that cannot be resolved through VISP\'s internal dispute resolution process, subject to any non-waivable consumer-protection rights you may have in your home province.' },
      { heading: '13. Changes to These Terms', body: 'We may update these Terms from time to time. Material changes will be communicated through the Platform or by email at least 14 days before they take effect, where reasonably practicable. Continued use of the Platform after the effective date constitutes acceptance of the updated Terms.' },
      { heading: '14. Contact Us', body: 'Questions about these Terms can be sent to support@vispapp.com (or such other address as VISP may publish on the Platform).' },
    ],
  },
  fr: {
    title: 'VISP — Conditions d\'utilisation',
    subtitle: 'Plateforme de prestataires de services indépendants vérifiés | Date d\'entrée en vigueur: 1er mai 2026 | Version 1.0',
    sections: [
      { heading: '1. Introduction', body: 'Bienvenue sur VISP (« VISP », « nous », « notre »). VISP exploite une plateforme de marché numérique (la « Plateforme ») qui met en relation des particuliers et des entreprises recherchant des services (« Clients ») avec des prestataires de services indépendants (« Prestataires »). VISP est un service de marché et de technologie. Nous ne sommes pas l\'employeur, l\'agent ou le représentant d\'aucun prestataire.\n\nCes conditions d\'utilisation (« Conditions ») régissent votre accès et votre utilisation de l\'application mobile VISP. En créant un compte, vous reconnaissez avoir lu et accepté ces Conditions.' },
      { heading: '2. Admissibilité', body: '• Vous devez avoir au moins 18 ans.\n• Vous devez résider au Canada et être légalement autorisé à utiliser des services de marché.\n• Les prestataires doivent être légalement autorisés à effectuer les services qu\'ils offrent.\n• Vous acceptez de fournir des informations exactes et à jour lors de l\'inscription.' },
      { heading: '3. Niveaux de prestataires et vérification', body: 'VISP utilise un système de vérification par niveaux pour aider les clients à comprendre le niveau de confiance associé à chaque prestataire.\n\nNiveau 1 — Nouveau / Non vérifié : Comptes nouvellement inscrits. Accès limité.\n\nNiveau 2 — Services généraux vérifiés : Prestataires ayant complété la vérification d\'identité et le filtrage des antécédents.\n\nNiveau 3 — Services réglementés / Licenciés : Prestataires ayant soumis et fait vérifier toutes les licences et certifications requises.\n\nNiveau 4 — Restreint (Non autorisé) : Activités d\'urgence et à haut risque. VISP ne facilite pas les services de niveau 4.' },
      { heading: '4. Services et conduites interdits', body: 'Les activités suivantes sont strictement interdites :\n\n• Toute activité illégale selon les lois canadiennes.\n• Services d\'urgence, traitements médicaux ou services de sécurité vitale (contactez le 911).\n• Services sexuels ou toute forme d\'activité pour adultes.\n• Services nécessitant une licence que le prestataire ne détient pas.\n• Harcèlement, menaces, discours haineux ou conduite abusive.\n• Sollicitation de transactions hors plateforme.\n• Fausse représentation d\'identité ou de qualifications.\n• Création de comptes multiples ou manipulation d\'évaluations.\n\nVISP se réserve le droit de suspendre tout compte en cas de violation.' },
      { heading: '5. Rôle de VISP en tant que marché', body: 'VISP est un marché, pas un fournisseur de services. VISP n\'emploie ni ne supervise les prestataires. Les prestataires sont des entrepreneurs indépendants. La vérification est un processus de diligence raisonnable et ne constitue pas une garantie de compétence ou de sécurité.' },
      { heading: '6. Réservations, paiements et frais', body: '• Tous les paiements doivent être traités via Stripe sur la Plateforme.\n• VISP facture une commission sur chaque transaction.\n• Les prestataires reçoivent leurs paiements via Stripe.\n• Les taxes applicables sont la responsabilité de la partie légalement tenue de les percevoir.\n• Les remboursements et annulations sont régis par notre politique de remboursement.' },
      { heading: '7. Avis, évaluations et résolution de litiges', body: 'Les clients et prestataires peuvent s\'évaluer mutuellement après chaque travail. Les avis doivent être honnêtes et respectueux.\n\nEn cas de litige, les deux parties doivent participer au processus de résolution de VISP, incluant photos, chat modéré et preuves. Les décisions de VISP sont finales au niveau de la plateforme.' },
      { heading: '8. Limitation de responsabilité', body: 'VISP n\'est pas responsable des actes, omissions ou qualité de travail des prestataires ou clients, des dommages matériels ou corporels, des litiges entre utilisateurs, ou des pannes de la Plateforme. Les badges de vérification sont informatifs uniquement.' },
      { heading: '9. Indemnisation', body: 'Vous acceptez d\'indemniser et de dégager VISP de toute réclamation, dommage ou dépense découlant de votre utilisation de la Plateforme, de votre violation de ces Conditions, ou de tout service que vous offrez ou recevez.' },
      { heading: '10. Suspension et résiliation', body: 'VISP peut suspendre ou résilier votre compte à tout moment en cas de violation de ces Conditions. Vous pouvez fermer votre compte à tout moment. Vos données seront traitées conformément à notre politique de confidentialité.' },
      { heading: '11. Propriété intellectuelle', body: 'Tout le contenu de la Plateforme est la propriété de VISP. Vous conservez la propriété du contenu que vous soumettez mais accordez à VISP une licence mondiale pour l\'utiliser.' },
      { heading: '12. Loi applicable et juridiction', body: 'Ces Conditions sont régies par les lois de la Province de l\'Ontario et les lois fédérales du Canada. Les parties se soumettent à la juridiction exclusive des tribunaux de l\'Ontario.' },
      { heading: '13. Modifications de ces Conditions', body: 'Nous pouvons mettre à jour ces Conditions. Les modifications importantes seront communiquées au moins 14 jours avant leur entrée en vigueur.' },
      { heading: '14. Nous contacter', body: 'Les questions peuvent être envoyées à support@vispapp.com.' },
    ],
  },
};

export default function TermsScreen(): React.JSX.Element {
  const theme = useTheme();
  const { language } = useTranslation();
  const c = content[language] ?? content.en;

  return (
    <GlassBackground>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{c.title}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{c.subtitle}</Text>
        {c.sections.map((s, i) => (
          <View key={i} style={styles.section}>
            <Text style={[styles.heading, { color: theme.textPrimary }]}>{s.heading}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{s.body}</Text>
          </View>
        ))}
        <View style={styles.spacer} />
      </ScrollView>
    </GlassBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 12, marginBottom: 24, lineHeight: 16 },
  section: { marginBottom: 20 },
  heading: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 22 },
  spacer: { height: 40 },
});
