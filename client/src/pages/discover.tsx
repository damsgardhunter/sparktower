import { useQuery } from "@tanstack/react-query";
import { UserCard } from "@/components/user-card";
import { Input } from "@/components/ui/input";
import { Loader2, Search, SlidersHorizontal } from "lucide-react";
import type { UserProfile, User } from "@shared/schema";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type UserWithProfile = User & { profile: UserProfile };

export default function Discover() {
  const [search, setSearch] = useState("");
  const { data: users, isLoading } = useQuery<UserWithProfile[]>({
    queryKey: [`/api/users/search?q=${encodeURIComponent(search)}`],
  });

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Discover People</h1>
          <p className="text-secondary mt-1">
            Find entrepreneurs and freelancers to join your next project.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary" />
            <Input
              placeholder="Search by name, skills, or interests..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-users"
            />
          </div>
          <Button variant="outline" className="md:w-auto" data-testid="button-filters">
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : users && users.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.map((user) => (
              <UserCard
                key={user.id}
                profile={user.profile}
                userName={user.firstName || user.email || "Anonymous"}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 border-2 border-dashed rounded-lg bg-card/50">
            <Search className="h-12 w-12 text-tertiary mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No users found</h3>
            <p className="text-secondary mt-2">
              Try adjusting your search terms or filters.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
