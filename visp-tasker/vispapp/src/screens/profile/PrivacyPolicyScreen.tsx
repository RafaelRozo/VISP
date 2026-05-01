/**
 * VISP - Privacy Policy Screen
 * Native scrollable content, bilingual EN/FR.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassBackground } from '../../components/glass';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';

const content = {
  en: {
    title: 'VISP — Privacy Policy',
    subtitle: 'Verified Independent Service Provider Platform | Effective Date: May 01, 2026 | Version 1.0',
    sections: [
      { heading: '1. Introduction', body: 'VISP ("VISP", "we", "us", or "our") respects your privacy and is committed to protecting your personal information. This Privacy Policy explains what information we collect, how we use and share it, how long we keep it, and the choices you have. It applies to your use of the VISP mobile application, website, and related services (the "Platform").\n\nVISP currently operates only in Canada. We comply with the Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial privacy legislation.' },
      { heading: '2. Information We Collect', body: '2.1 Information from All Users\n\n• Account information: name, email address, phone number, password, and profile photo.\n• Location information: approximate or precise location (with your permission) used to match Clients with nearby Service Providers.\n• Communications: messages, dispute submissions, photos, reviews, and ratings exchanged on the Platform.\n• Device and usage data: device identifiers, IP address, operating system, app version, in-app actions, and crash logs.\n• Payment information: payment is processed by Stripe. VISP does not store full payment card numbers; we receive limited transaction data (such as last four digits, transaction ID, and status) from Stripe.\n\n2.2 Additional Information from Service Providers\n\n• Identity verification documents: government-issued ID, selfie/liveness checks, and supporting documents required to confirm identity.\n• Background check information: information collected for criminal-record screening and related risk checks.\n• Professional credentials: licenses, certifications, insurance certificates, and other documents required for Tier 3 services.\n• Banking/payout information: handled directly by Stripe in accordance with Stripe\'s privacy notices.' },
      { heading: '3. How We Collect Information', body: '• Directly from you when you register, complete a profile, book a service, message a user, or submit a dispute.\n• Automatically from your device when you use the Platform (cookies, SDKs, analytics).\n• From third-party services such as Stripe (payments) and any background-check or fraud-prevention partners we engage in the future.' },
      { heading: '4. How We Use Your Information', body: 'We use personal information to:\n\n• Create and maintain your account and profile.\n• Match Clients with Service Providers and facilitate bookings.\n• Verify identity, run background checks, and confirm professional licenses for Tier 3 access.\n• Process payments and payouts through Stripe and calculate platform fees.\n• Operate reviews, ratings, dispute resolution, and trust-and-safety functions.\n• Communicate with you about your account, transactions, support requests, and policy updates.\n• Detect, prevent, and address fraud, abuse, security incidents, and violations of our Terms.\n• Comply with legal obligations and respond to lawful requests from regulators or law enforcement.\n• Improve, secure, and develop new features for the Platform.' },
      { heading: '5. How We Share Information', body: 'We share personal information only as described below:\n\n• Between Clients and Service Providers: limited profile information (name, photo, ratings, location range, tier badge, and messages) is shared to facilitate bookings.\n• Service providers acting on our behalf: Stripe (payments), cloud hosting and analytics providers, customer-support tools, and (where applicable) background-check partners. These providers are bound by confidentiality and data-protection obligations.\n• Legal and safety: we may disclose information when required by law, court order, or to protect the rights, property, or safety of VISP, our users, or the public.\n• Business transactions: in connection with a merger, acquisition, financing, or sale of assets, subject to appropriate confidentiality safeguards.\n• With your consent: for any other purpose disclosed at the time of collection.\n\nWe do not sell your personal information.' },
      { heading: '6. Data Storage and International Transfers', body: 'VISP currently serves Canadian users. Some of our service providers (including Stripe and cloud hosting partners) may store or process information outside of Canada, including in the United States. When information is transferred outside of Canada, it may be subject to the laws of the jurisdiction where it is stored, including lawful access by foreign authorities. We use contractual and technical safeguards to protect information in transit and at rest.' },
      { heading: '7. Data Retention and Deletion', body: '• Active accounts: we retain your information for as long as your account is active and as needed to provide the Platform.\n• Account deletion: when you delete your account, we retain your information for up to 30 days to allow for recovery, fraud prevention, and dispute completion. After 30 days, personal information is deleted or de-identified, except where longer retention is required by law.\n• Verification documents: ID and background-check documents are retained while you remain a Service Provider and for a reasonable period afterward to comply with legal, audit, and trust-and-safety obligations.\n• Reviews and transaction history: may be retained in anonymized or aggregated form to preserve the integrity of the marketplace.' },
      { heading: '8. Security', body: 'We use industry-standard administrative, technical, and physical safeguards to protect personal information, including encryption in transit, restricted access on a need-to-know basis, and monitoring for unauthorized activity. No system is perfectly secure, and we cannot guarantee absolute security. You are responsible for keeping your account credentials confidential.' },
      { heading: '9. Your Privacy Rights', body: 'Subject to applicable Canadian privacy law, you have the right to:\n\n• Access the personal information we hold about you.\n• Request correction of inaccurate or incomplete information.\n• Withdraw consent for certain processing (subject to legal or contractual restrictions).\n• Request deletion of your account and associated personal information.\n• File a complaint with the Office of the Privacy Commissioner of Canada or your provincial privacy regulator.\n\nTo exercise these rights, contact us using the details in Section 13. We may need to verify your identity before responding.' },
      { heading: '10. Children\'s Privacy', body: 'The Platform is not intended for individuals under the age of 18. We do not knowingly collect personal information from minors. If we become aware that we have collected personal information from a person under 18, we will delete it promptly.' },
      { heading: '11. Cookies and Similar Technologies', body: 'VISP and our analytics partners use cookies, mobile SDKs, and similar technologies to operate the Platform, remember your preferences, measure performance, and detect fraud. You can control certain technologies through your device or browser settings, although some Platform features may not function correctly if disabled.' },
      { heading: '12. Changes to This Policy', body: 'We may update this Privacy Policy from time to time. Material changes will be communicated through the Platform or by email before they take effect. The "Effective Date" at the top of this Policy indicates when it was last revised.' },
      { heading: '13. Contact Our Privacy Office', body: 'If you have questions, concerns, or requests regarding this Privacy Policy, please contact our Privacy Officer at privacy@vispapp.com. You also have the right to contact the Office of the Privacy Commissioner of Canada at www.priv.gc.ca.' },
    ],
  },
  fr: {
    title: 'VISP — Politique de confidentialité',
    subtitle: 'Plateforme de prestataires de services indépendants vérifiés | Date d\'entrée en vigueur: 1er mai 2026 | Version 1.0',
    sections: [
      { heading: '1. Introduction', body: 'VISP (« VISP », « nous », « notre ») respecte votre vie privée et s\'engage à protéger vos renseignements personnels. Cette politique de confidentialité explique quelles informations nous recueillons, comment nous les utilisons et les partageons, combien de temps nous les conservons, et les choix qui s\'offrent à vous. Elle s\'applique à votre utilisation de l\'application mobile VISP, du site Web et des services connexes (la « Plateforme »).\n\nVISP opère actuellement uniquement au Canada. Nous nous conformons à la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE) et aux lois provinciales applicables en matière de vie privée.' },
      { heading: '2. Informations que nous recueillons', body: '2.1 Informations de tous les utilisateurs\n\n• Informations de compte : nom, adresse courriel, numéro de téléphone, mot de passe et photo de profil.\n• Informations de localisation : localisation approximative ou précise (avec votre permission) utilisée pour jumeler les clients avec les prestataires à proximité.\n• Communications : messages, soumissions de litiges, photos, avis et évaluations échangés sur la Plateforme.\n• Données d\'appareil et d\'utilisation : identifiants d\'appareil, adresse IP, système d\'exploitation, version de l\'application, actions dans l\'application et journaux de plantage.\n• Informations de paiement : les paiements sont traités par Stripe. VISP ne stocke pas les numéros complets de carte de paiement.\n\n2.2 Informations supplémentaires des prestataires\n\n• Documents de vérification d\'identité.\n• Informations de vérification des antécédents.\n• Accréditations professionnelles : licences, certifications, certificats d\'assurance.\n• Informations bancaires/de paiement : gérées directement par Stripe.' },
      { heading: '3. Comment nous recueillons les informations', body: '• Directement de vous lors de l\'inscription, de la complétion de profil, de la réservation d\'un service ou de la soumission d\'un litige.\n• Automatiquement depuis votre appareil lorsque vous utilisez la Plateforme.\n• De services tiers tels que Stripe (paiements) et tout partenaire de vérification d\'antécédents.' },
      { heading: '4. Comment nous utilisons vos informations', body: 'Nous utilisons les renseignements personnels pour :\n\n• Créer et maintenir votre compte et profil.\n• Jumeler les clients avec les prestataires et faciliter les réservations.\n• Vérifier l\'identité et les licences professionnelles.\n• Traiter les paiements et les virements via Stripe.\n• Gérer les avis, évaluations et résolution de litiges.\n• Communiquer avec vous concernant votre compte et les mises à jour.\n• Détecter et prévenir la fraude et les abus.\n• Se conformer aux obligations légales.\n• Améliorer et développer la Plateforme.' },
      { heading: '5. Comment nous partageons les informations', body: 'Nous partageons les renseignements personnels uniquement comme décrit ci-dessous :\n\n• Entre clients et prestataires : informations de profil limitées partagées pour faciliter les réservations.\n• Fournisseurs de services agissant en notre nom : Stripe, hébergement cloud, outils de support client.\n• Légal et sécurité : divulgation lorsque requis par la loi.\n• Transactions commerciales : dans le cadre d\'une fusion, acquisition ou vente d\'actifs.\n• Avec votre consentement.\n\nNous ne vendons pas vos renseignements personnels.' },
      { heading: '6. Stockage des données et transferts internationaux', body: 'VISP dessert actuellement les utilisateurs canadiens. Certains de nos fournisseurs de services peuvent stocker ou traiter des informations à l\'extérieur du Canada. Nous utilisons des mesures contractuelles et techniques pour protéger les informations.' },
      { heading: '7. Conservation et suppression des données', body: '• Comptes actifs : nous conservons vos informations tant que votre compte est actif.\n• Suppression de compte : nous conservons vos informations jusqu\'à 30 jours après la suppression pour permettre la récupération et la prévention de fraude.\n• Documents de vérification : conservés tant que vous êtes prestataire.\n• Avis et historique : peuvent être conservés sous forme anonymisée.' },
      { heading: '8. Sécurité', body: 'Nous utilisons des mesures administratives, techniques et physiques conformes aux normes de l\'industrie pour protéger les renseignements personnels, y compris le chiffrement en transit et l\'accès restreint. Aucun système n\'est parfaitement sécurisé. Vous êtes responsable de garder vos identifiants confidentiels.' },
      { heading: '9. Vos droits en matière de vie privée', body: 'Conformément aux lois canadiennes applicables, vous avez le droit de :\n\n• Accéder aux renseignements personnels que nous détenons.\n• Demander la correction d\'informations inexactes.\n• Retirer votre consentement pour certains traitements.\n• Demander la suppression de votre compte.\n• Déposer une plainte auprès du Commissariat à la protection de la vie privée du Canada.\n\nContactez-nous à la section 13 pour exercer ces droits.' },
      { heading: '10. Vie privée des enfants', body: 'La Plateforme n\'est pas destinée aux personnes de moins de 18 ans. Nous ne recueillons pas sciemment de renseignements personnels de mineurs.' },
      { heading: '11. Témoins et technologies similaires', body: 'VISP et nos partenaires d\'analyse utilisent des témoins (cookies), des SDK mobiles et des technologies similaires pour opérer la Plateforme, mémoriser vos préférences et détecter la fraude.' },
      { heading: '12. Modifications de cette politique', body: 'Nous pouvons mettre à jour cette politique de temps à autre. Les modifications importantes seront communiquées via la Plateforme ou par courriel avant leur entrée en vigueur.' },
      { heading: '13. Contacter notre bureau de la vie privée', body: 'Pour toute question ou demande concernant cette politique, contactez notre responsable de la vie privée à privacy@vispapp.com. Vous pouvez également contacter le Commissariat à la protection de la vie privée du Canada à www.priv.gc.ca.' },
    ],
  },
};

export default function PrivacyPolicyScreen(): React.JSX.Element {
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
