/**
 * Super User - Document Delete API
 *
 * DELETE /api/superuser/documents/[docId] - Delete document (only if uploaded by this super user)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getDocumentWithCategories } from '@/lib/db/compat';
import { deleteDocument } from '@/lib/ingest';

// DELETE - Delete document (only if uploaded by this super user and in their assigned categories)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { docId } = await params;
    const numericDocId = parseInt(docId, 10);

    if (isNaN(numericDocId)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    // Get document with categories
    const doc = await getDocumentWithCategories(numericDocId);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get super user's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData) {
      return NextResponse.json({ error: 'Super user data not found' }, { status: 404 });
    }

    // Verify the document is in one of super user's assigned categories
    const assignedCategoryIds = superUserData.assignedCategories.map(c => c.categoryId);
    const docCategoryIds = doc.categories.map(c => c.id);
    const hasAccess = docCategoryIds.some(id => assignedCategoryIds.includes(id));

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to delete this document' },
        { status: 403 }
      );
    }

    // Verify the document was uploaded by this super user
    if (doc.uploaded_by !== user.email) {
      return NextResponse.json(
        { error: 'You can only delete documents you uploaded' },
        { status: 403 }
      );
    }

    // Delete the document
    const result = await deleteDocument(docId);
    if (!result) {
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deleted: {
        id: numericDocId,
        filename: result.filename,
        chunksRemoved: result.chunksRemoved,
      },
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
