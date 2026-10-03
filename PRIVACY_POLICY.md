# Privacy Policy

**MOTM KAM Portal (MOTM Flow)**
**Effective date:** October 3, 2026
**Last updated:** October 3, 2026

This Privacy Policy explains how MOTM Technologies ("**we**", "**us**", "**our**") collects, uses, stores, and protects information when you use MOTM KAM Portal, also known as MOTM Flow (the "**Service**"), a lead management and sales automation tool. It also explains what happens when you connect your Google account to the Service.

If you have questions about this policy, contact us at **govinda@motm.tech**.

---

## 1. Information we collect

### 1.1 Account information
When you sign in, we collect your name, email address, and role in the Service. Authentication is handled through our authentication provider, Supabase.

### 1.2 Business and lead data you enter
The Service is used to manage sales leads. You and your team may enter or import information about your prospects and customers, such as names, company names, email addresses, phone numbers, notes, tasks, meetings, proposals, and message history. You are responsible for having the right to store and contact these people.

### 1.3 Messaging and email data
If you connect email or WhatsApp, we process the messages sent through those channels, along with delivery status, so the Service can run your automations and show conversation history.

### 1.4 Google account and Google Calendar data
This section applies only if you choose to connect Google Calendar. See Section 3 for full details.

### 1.5 Technical data
We may collect basic technical information such as error logs and request metadata to keep the Service secure and working.

---

## 2. How we use information

We use the information above to:

- Provide and operate the Service, including scheduling meetings, sending follow-ups, and running your automations.
- Authenticate you and keep your workspace secure.
- Diagnose problems, prevent abuse, and improve reliability.
- Communicate with you about the Service.

We do **not** sell your personal information, and we do **not** use your data for advertising.

---

## 3. Google user data

### 3.1 What you are asked to allow
When you click **Connect Google Calendar**, Google asks you to approve the following permissions:

| Permission (scope) | Why we request it |
|---|---|
| `https://www.googleapis.com/auth/calendar.events` | To create, update, and delete calendar events (including a Google Meet link) for meetings you schedule inside the Service. |
| `https://www.googleapis.com/auth/userinfo.email` | To show you which Google account is connected. |

### 3.2 What we do with Google Calendar access
When you schedule, reschedule, or cancel a meeting in the Service, we:

- **Create** a calendar event on your connected calendar, with a Google Meet link, and invite the lead and any participants you added.
- **Update** that event if you reschedule the meeting.
- **Delete** that event if you cancel the meeting.

We only act on events that the Service itself creates for meetings you schedule in it. We do not browse, copy, or analyze your other calendar events.

### 3.3 What we store
- The **email address** of the connected Google account, to display in Settings.
- A **refresh token**, which lets the Service create and update events on your behalf without asking you to sign in each time. It is stored **encrypted** in our database.
- The **event ID and Meet link** of events we create, so we can update or cancel them later.

We do not store your Google password.

### 3.4 Limited Use disclosure
MOTM Flow's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the **Limited Use** requirements. Specifically:

- We use Google user data only to provide and improve the user-facing calendar features described above.
- We do not transfer Google user data to others except as needed to provide those features, to comply with applicable law, or as part of a merger or sale of assets with notice to you.
- We do not use Google user data for serving advertisements.
- We do not allow humans to read your Google user data unless we have your affirmative consent for specific data, it is necessary for security purposes (for example, investigating abuse), to comply with applicable law, or the data is aggregated and anonymized for internal operations.
- We do not use Google user data to develop, improve, or train generalized AI or machine learning models.

### 3.5 Disconnecting and revoking access
You can disconnect Google Calendar at any time from **Settings → Google Calendar → Disconnect**. When you do, we delete the stored refresh token and connected email from our database, and the Service can no longer access your calendar.

You can also revoke the Service's access directly from your Google Account at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). If access is revoked this way, the Service will notice on its next attempt and ask you to reconnect.

Events already created on your calendar remain there unless you delete them.

---

## 4. How we share information

We share information only in these limited cases:

- **Service providers** that help us run the Service, acting on our instructions. These include our database and authentication provider (Supabase), our hosting provider, and the email and messaging providers you choose to connect (for example, Resend, your SMTP provider, or WhatsApp).
- **Google**, when the Service calls Google Calendar on your behalf as described in Section 3.
- **Legal reasons**, if required by law or to protect the rights, safety, and security of our users or the Service.
- **Business transfers**, if we are involved in a merger, acquisition, or sale of assets, in which case we will notify you.

We do not sell personal information.

---

## 5. Data security

We take reasonable measures to protect your information, including:

- Encrypting sensitive credentials, such as Google refresh tokens and provider secrets, before storing them in the database.
- Encrypting data in transit using HTTPS.
- Restricting access to data by user and workspace.

No system is perfectly secure, and we cannot guarantee absolute security. If we become aware of a breach affecting your data, we will notify you as required by law.

---

## 6. Data retention and deletion

We keep your information for as long as your account is active or as needed to provide the Service. Google Calendar credentials are deleted when you disconnect (Section 3.5).

To request deletion of your account or your data, email **govinda@motm.tech** from your account email address. We will respond within a reasonable time and delete the data we are not legally required to keep.

---

## 7. Your rights and choices

Depending on where you live, you may have the right to access, correct, export, or delete your personal information, and to object to or restrict certain processing. To exercise these rights, contact us at **govinda@motm.tech**.

If you entered information about other people (such as leads) into the Service, you are responsible for responding to their requests and for having a lawful basis to store and contact them.

---

## 8. Children's privacy

The Service is intended for business use and is not directed to children under 16. We do not knowingly collect personal information from children.

---

## 9. International data transfers

Our providers may process data in countries other than your own. Where required, we take steps to ensure appropriate safeguards are in place.

---

## 10. Changes to this policy

We may update this Privacy Policy from time to time. We will post the updated version on this page and change the "Last updated" date. If changes are significant, we will give additional notice, for example by email or inside the Service.

---

## 11. Contact us

MOTM Technologies
Email: **govinda@motm.tech**
Website: **https://b2botix.ai**
