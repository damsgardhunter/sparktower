/**
 * What the company has said on the feed.
 *
 * Everyone in the company can read it; those holding "post as the company"
 * (leaders hold it by their role) can write here in the company's name and
 * take down anything posted in it. Anyone can remove a post they wrote
 * themselves — the card's own delete does that. Each post keeps the name of
 * the person who wrote it, so the company can always see who spoke for it.
 */
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Megaphone, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FeedComposer } from "@/components/feed-composer";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";

interface PostsPage {
  posts: FeedPostWithDetails[];
  nextCursor: string | null;
  canPost: boolean;
  canRemoveOthers: boolean;
}

export function PostsTab({ companyId }: { companyId: string; canManage: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  // The page has already loaded the company under this key; its name is what the composer posts as.
  const { data: view } = useQuery<{ company: { id: string; name: string } }>({ queryKey: [`/api/companies/${companyId}`] });

  const key = ["/api/companies", companyId, "posts"];
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const url = `/api/companies/${companyId}/posts${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`;
      return (await apiRequest("GET", url)).json() as Promise<PostsPage>;
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const remove = useMutation({
    mutationFn: async (postId: string) => (await apiRequest("DELETE", `/api/companies/${companyId}/posts/${postId}`)).json(),
    onSuccess: (r: any) => {
      toast(r?.thread === "kept"
        ? { title: "Post removed", description: "Other people's replies are still there, without the post." }
        : { title: "Post removed" });
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    },
    onError: (err) => toast({ title: "Couldn't remove the post", description: errorText(err), variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (isError || !data) return <p className="py-6 text-sm text-muted-foreground">The company's posts couldn't be loaded. Try again in a moment.</p>;

  const first = data.pages[0];
  const posts = data.pages.flatMap((p) => p.posts);

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-2">
      {first.canPost && view?.company
        ? <FeedComposer asCompany={{ id: companyId, name: view.company.name }} />
        : (
          <p className="text-xs text-muted-foreground" data-testid="text-posts-no-power">
            Posting in the company's name needs the "Post as the company" power. A leader can give it to you on the Team tab.
          </p>
        )}

      {posts.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="py-10 text-center space-y-2">
            <Megaphone className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">Nothing posted in the company's name yet</p>
            <p className="text-xs text-muted-foreground">Posts made here appear on the feed under the company's name, with the name of whoever wrote them.</p>
          </CardContent>
        </Card>
      ) : (
        posts.map((post) => (
          <div key={post.id} className="space-y-1">
            <FeedPostCard post={post} />
            {/* The author has the card's own delete; others holding the power can withdraw it for the company. */}
            {first.canRemoveOthers && post.authorId !== user?.id && (
              <div className="flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive" disabled={remove.isPending} data-testid={`button-remove-company-post-${post.id}`}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove from the company
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this post?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It comes off the feed for everyone. If other people have replied, their replies stay, without the post. The company's log records that you removed it.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove.mutate(post.id)} data-testid={`button-confirm-remove-${post.id}`}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        ))
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} data-testid="button-more-company-posts">
            {isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Show older posts"}
          </Button>
        </div>
      )}
    </div>
  );
}
