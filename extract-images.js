const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');
const busboy = require('busboy');

// The main handler for the Netlify Function
exports.handler = async (event) => {
    // Check if the request method is POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    // Since Netlify functions don't have a file system, we'll handle everything in memory
    const extractedImages = [];
    let pdfBuffer;

    // Use a promise to handle the stream-based file upload
    await new Promise((resolve, reject) => {
        const bb = busboy({ headers: event.headers });

        bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname === 'pdfFile' && mimetype === 'application/pdf') {
                const chunks = [];
                file.on('data', chunk => chunks.push(chunk));
                file.on('end', () => {
                    pdfBuffer = Buffer.concat(chunks);
                    resolve();
                });
                file.on('error', err => reject(err));
            } else {
                file.resume(); // Ignore other fields
            }
        });

        // The body is base64 encoded by Netlify
        bb.end(Buffer.from(event.body, 'base64'));
    });

    // Handle case where no PDF was uploaded
    if (!pdfBuffer) {
        return { statusCode: 400, body: 'No PDF file uploaded.' };
    }

    try {
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();

        // Extract images from each page
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const images = page.node.getImages();

            // pdf-lib doesn't have a direct image extraction method
            // This is a simplified example. For a real app, you would need
            // a more robust method to extract all image types.
            // This example assumes images are embedded as simple objects.
            for (let j = 0; j < images.length; j++) {
                const imageObject = images[j];
                const imageBytes = imageObject.data;
                const mimeType = imageObject.mimeType;

                if (imageBytes && mimeType) {
                    const extension = mimeType.split('/')[1];
                    extractedImages.push({
                        name: `image_page_${i + 1}_${j + 1}.${extension}`,
                        data: imageBytes
                    });
                }
            }
        }

        if (extractedImages.length === 0) {
            return {
                statusCode: 404,
                body: 'No images found in the PDF.'
            };
        }

        // Create a zip file in memory using archiver
        const archive = archiver('zip', { zlib: { level: 9 } });
        const zipBuffer = await new Promise((resolve, reject) => {
            const buffers = [];
            archive.on('data', chunk => buffers.push(chunk));
            archive.on('end', () => resolve(Buffer.concat(buffers)));
            archive.on('error', err => reject(err));

            for (const image of extractedImages) {
                archive.append(image.data, { name: image.name });
            }
            archive.finalize();
        });

        // Return the zip file as a base64 encoded response
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="extracted_images.zip"'
            },
            body: zipBuffer.toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('Error processing PDF:', error);
        return {
            statusCode: 500,
            body: `Internal Server Error: ${error.message}`
        };
    }
};
