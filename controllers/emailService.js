// // First, install required packages:
// // npm install nodemailer

// // Create a new file: utils/emailService.js
// const nodemailer = require('nodemailer');

// // Email configuration
// const emailConfig = {
//     host: process.env.EMAIL_HOST || 'smtp.gmail.com', // Change based on your email provider
//     port: process.env.EMAIL_PORT || 587,
//     secure: false, // true for 465, false for other ports
//     auth: {
//         user: process.env.EMAIL_USER, // Your email address
//         pass: process.env.EMAIL_PASS  // Your email password or app password
//     }
// };

// // Create transporter
// const createTransporter = () => {
//     return nodemailer.createTransport(emailConfig);
// };

// // Email templates for different statuses
// const emailTemplates = {
//     'P1 - PASSED': {
//         subject: 'Congratulations! You\'ve Passed the Initial Screening - Company ABC',
//         getHtml: (applicantName, jobTitle) => `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//                 <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
//                     <h1 style="color: #28a745;">Congratulations!</h1>
//                 </div>
//                 <div style="padding: 20px;">
//                     <p>Dear ${applicantName},</p>
                    
//                     <p>We are delighted to inform you that you have successfully passed the initial screening process for the <strong>${jobTitle}</strong> position at Company ABC.</p>
                    
//                     <p>This is an important milestone in your application journey with us. Your qualifications and responses have impressed our initial screening team.</p>
                    
//                     <h3>What's Next?</h3>
//                     <ul>
//                         <li>You will receive a scheduling link for your interview shortly</li>
//                         <li>Our HR team will contact you within 2-3 business days</li>
//                         <li>Please log into your applicant portal for updates</li>
//                     </ul>
                    
//                     <p>We look forward to the next step in our process together.</p>
                    
//                     <p>Best regards,<br>
//                     <strong>Company ABC Recruitment Team</strong></p>
//                 </div>
//                 <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
//                     <p>This is an automated message. Please do not reply to this email.</p>
//                 </div>
//             </div>
//         `
//     },
    
//     'P2 - PASSED': {
//         subject: 'Great News! You\'ve Advanced to Final Interview - Company ABC',
//         getHtml: (applicantName, jobTitle) => `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//                 <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
//                     <h1 style="color: #28a745;">Excellent Progress!</h1>
//                 </div>
//                 <div style="padding: 20px;">
//                     <p>Dear ${applicantName},</p>
                    
//                     <p>Congratulations! We are pleased to inform you that you have successfully passed the initial interview for the <strong>${jobTitle}</strong> position.</p>
                    
//                     <p>Your performance in the interview process has been impressive, and we would like to invite you for a final interview with our senior management team.</p>
                    
//                     <h3>Final Interview Details:</h3>
//                     <ul>
//                         <li>This will be the final step in our selection process</li>
//                         <li>You'll meet with senior leadership</li>
//                         <li>Focus will be on cultural fit and long-term vision</li>
//                         <li>Interview scheduling link will be provided shortly</li>
//                     </ul>
                    
//                     <p>Please continue to check your applicant portal for scheduling updates.</p>
                    
//                     <p>We're excited about the possibility of having you join our team!</p>
                    
//                     <p>Best regards,<br>
//                     <strong>Company ABC Recruitment Team</strong></p>
//                 </div>
//                 <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
//                     <p>This is an automated message. Please do not reply to this email.</p>
//                 </div>
//             </div>
//         `
//     },
    
//     'P3 - PASSED': {
//         subject: 'Welcome to Company ABC! Job Offer Inside',
//         getHtml: (applicantName, jobTitle) => `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//                 <div style="background-color: #28a745; padding: 20px; text-align: center;">
//                     <h1 style="color: white;">Welcome to the Team!</h1>
//                 </div>
//                 <div style="padding: 20px;">
//                     <p>Dear ${applicantName},</p>
                    
//                     <p><strong>Congratulations!</strong> We are thrilled to extend a job offer for the <strong>${jobTitle}</strong> position at Company ABC.</p>
                    
//                     <p>After careful consideration of all candidates, we believe you are the perfect fit for our team and organization.</p>
                    
//                     <h3>Your Job Offer Details:</h3>
//                     <ul>
//                         <li>Position: <strong>${jobTitle}</strong></li>
//                         <li>Status: Offer Extended</li>
//                         <li>Next Steps: Please log into your applicant portal to review and respond to the offer</li>
//                     </ul>
                    
//                     <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;">
//                         <h4 style="color: #155724; margin-top: 0;">Important:</h4>
//                         <p style="color: #155724; margin-bottom: 0;">Please log into your applicant portal to review the complete offer details and respond within the specified timeframe.</p>
//                     </div>
                    
//                     <p>We're excited to welcome you to the Company ABC family and look forward to your contribution to our continued success.</p>
                    
//                     <p>Congratulations once again!</p>
                    
//                     <p>Warm regards,<br>
//                     <strong>Company ABC Recruitment Team</strong></p>
//                 </div>
//                 <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
//                     <p>This is an automated message. Please do not reply to this email.</p>
//                 </div>
//             </div>
//         `
//     }
// };

// // Main email sending function
// const sendStatusUpdateEmail = async (applicantEmail, applicantName, jobTitle, status) => {
//     try {
//         console.log(`📧 [Email Service] Preparing to send email for status: ${status}`);
        
//         // Check if we have a template for this status
//         const template = emailTemplates[status];
//         if (!template) {
//             console.log(`⚠️ [Email Service] No email template found for status: ${status}`);
//             return { success: false, message: 'No email template for this status' };
//         }
        
//         // Create transporter
//         const transporter = createTransporter();
        
//         // Verify SMTP connection
//         await transporter.verify();
//         console.log('✅ [Email Service] SMTP connection verified');
        
//         // Prepare email content
//         const mailOptions = {
//             from: `"Company ABC Recruitment" <${process.env.EMAIL_USER}>`,
//             to: applicantEmail,
//             subject: template.subject,
//             html: template.getHtml(applicantName, jobTitle)
//         };
        
//         // Send email
//         const info = await transporter.sendMail(mailOptions);
//         console.log(`✅ [Email Service] Email sent successfully: ${info.messageId}`);
        
//         return {
//             success: true,
//             messageId: info.messageId,
//             message: 'Email sent successfully'
//         };
        
//     } catch (error) {
//         console.error('❌ [Email Service] Error sending email:', error);
//         return {
//             success: false,
//             error: error.message,
//             message: 'Failed to send email'
//         };
//     }
// };

// // Function to send batch emails (useful for bulk status updates)
// const sendBatchStatusEmails = async (applicants, status) => {
//     const results = [];
    
//     for (const applicant of applicants) {
//         try {
//             const result = await sendStatusUpdateEmail(
//                 applicant.email,
//                 applicant.name,
//                 applicant.jobTitle,
//                 status
//             );
            
//             results.push({
//                 email: applicant.email,
//                 success: result.success,
//                 messageId: result.messageId || null,
//                 error: result.error || null
//             });
            
//             // Add delay between emails to avoid rate limiting
//             await new Promise(resolve => setTimeout(resolve, 1000));
            
//         } catch (error) {
//             console.error(`❌ [Email Service] Error sending email to ${applicant.email}:`, error);
//             results.push({
//                 email: applicant.email,
//                 success: false,
//                 error: error.message
//             });
//         }
//     }
    
//     return results;
// };

// // Test email function (useful for development)
// const sendTestEmail = async (testEmail) => {
//     try {
//         const transporter = createTransporter();
        
//         const mailOptions = {
//             from: `"Company ABC Test" <${process.env.EMAIL_USER}>`,
//             to: testEmail,
//             subject: 'Email Service Test - Company ABC',
//             html: `
//                 <div style="font-family: Arial, sans-serif; padding: 20px;">
//                     <h2>Email Service Test</h2>
//                     <p>This is a test email to verify that the email service is working correctly.</p>
//                     <p>Timestamp: ${new Date().toISOString()}</p>
//                 </div>
//             `
//         };
        
//         const info = await transporter.sendMail(mailOptions);
//         console.log('✅ [Email Service] Test email sent:', info.messageId);
        
//         return { success: true, messageId: info.messageId };
//     } catch (error) {
//         console.error('❌ [Email Service] Test email failed:', error);
//         return { success: false, error: error.message };
//     }
// };

// module.exports = {
//     sendStatusUpdateEmail,
//     sendBatchStatusEmails,
//     sendTestEmail
// };